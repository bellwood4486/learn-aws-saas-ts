# M1: platform層 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `infra/platform/` に S3・DynamoDB・SQS+DLQ・ECR・アプリ用シークレットを Terraform で実装して apply し、`@repo/core` に各リソースへの薄いクライアントラッパーを実装して、ローカルの SSO 認証情報から実 AWS に繋いで動作確認する。

**Architecture:** `infra/bootstrap/` が作った tfstate バケットを S3 backend として使う新しい Terraform 層（`infra/platform/`）を、リソース種別ごとにファイル分割して追加する。`@repo/core` にはドメインロジックを持たない AWS SDK v3 の薄いラッパー関数（put/get 相当）のみを追加し、テストは `aws-sdk-client-mock` で SDK コマンド呼び出しを検証する。GitHub OIDC provider/role は M8（CI/CD）で使うタイミングに合わせて作るため、このプランのスコープには含めない。

**Tech Stack:** Terraform 1.15.8 / AWS provider `~> 6.0` / TFLint（`tflint-ruleset-aws`）、AWS SDK for JavaScript v3、Vitest + `aws-sdk-client-mock`

**Spec:** `docs/superpowers/specs/2026-08-15-aws-saas-backend-design.md`（M1 セクション、「Terraform のレイヤー分割」節）

## Global Constraints

- Node は `mise.toml` で固定した 24.19.0 を使う。相対 import には `.ts` 拡張子を必ず書く（例: `import { x } from './s3.ts'`）
- `enum` / パラメータプロパティ / デコレータ / 実行時 `namespace` は使えない（Node のネイティブ型除去の制約）
- AWS 認証は SDK v3 のデフォルト探索に任せる。クライアント生成時に認証情報を渡さない（`new S3Client({})`）
- Terraform リソース名は snake_case・単数形。その種類で唯一のものは `this` または `main`
- アカウント ID をファイルに直書きしない。`data "aws_caller_identity" "current"` を使う
- provider の `default_tags` で `Project` / `ManagedBy` / `Layer` を全リソースに付与する
- 秘匿値（シークレットの実値）は outputs に出さない。ARN / ID / エンドポイントのみ出力する
- backend は S3 のみ、DynamoDB ロックテーブルは使わない（`use_lockfile = true`）
- destroy で確実に消えるよう、シークレットには `recovery_window_in_days = 0` を明示する
- ECR は lifecycle policy で最新10個のイメージのみ保持する
- ユニットテストは AWS に一切繋がない。AWS クライアントは `aws-sdk-client-mock` でモックする
- `infra/platform/` のファイル構成は `infra/bootstrap/` に倣う: `versions.tf` / `providers.tf` / `variables.tf` / `outputs.tf` / `README.md` は必須。150行を超えるリソース群はリソース種別ごとのファイル（`s3.tf` など）に分離する

---

## Task 1: platform層の骨格 + backend 配線

`infra/bootstrap/` が作った tfstate バケットを S3 backend として使うための骨格ファイルと、bucket 名（アカウント ID を含むため直書きできない）を `-backend-config` 経由で渡す justfile の配線を作る。

**Files:**
- Create: `infra/platform/versions.tf`
- Create: `infra/platform/providers.tf`
- Create: `infra/platform/variables.tf`
- Create: `infra/platform/data.tf`
- Modify: `justfile:44-45,49-50`（`tf-plan` / `tf-apply` レシピ）

**Interfaces:**
- Produces: `var.aws_region`, `var.project_name`, `data.aws_caller_identity.current`（後続タスクの全リソースが参照する）

- [ ] **Step 1: versions.tf を作成する**

`infra/bootstrap/versions.tf` と同一内容。

```hcl
terraform {
  required_version = ">= 1.15.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
```

- [ ] **Step 2: providers.tf を作成する**

bootstrap 層と異なり、backend "s3" ブロックを持つ。`bucket` はアカウント ID を含むため直書きせず、`-backend-config` で init 時に渡す（Step 5 参照）。

```hcl
terraform {
  backend "s3" {
    key          = "platform/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "learn-aws-saas-ts"
      ManagedBy = "terraform"
      Layer     = "platform"
    }
  }
}
```

- [ ] **Step 3: variables.tf を作成する**

`infra/bootstrap/variables.tf` と同一内容。

```hcl
variable "aws_region" {
  description = "リソースを作る AWS リージョン。"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "リソース名のプレフィックスとして使うプロジェクト名。"
  type        = string
  default     = "learn-aws-saas-ts"
}
```

- [ ] **Step 4: data.tf を作成する**

アカウント ID をハードコードしないための data source。複数リソースファイルから参照するため、単一リソースに紐付けず独立したファイルに置く。

```hcl
data "aws_caller_identity" "current" {}
```

- [ ] **Step 5: justfile の tf-plan / tf-apply に backend-config を配線する**

`infra/platform/` 以降の層は bucket 名をハードコードできないため、`infra/bootstrap` の output から都度取得して `terraform init` に渡す。

`justfile:44` を次のように変更する:

```just
# 指定した層で terraform plan を実行する（例: just tf-plan platform）
[group('tf')]
tf-plan layer:
    cd infra/{{layer}} && terraform init -input=false -backend-config="bucket=$(cd ../bootstrap && terraform output -raw tfstate_bucket)" && terraform plan
```

`justfile:49` を次のように変更する:

```just
# 指定した層で terraform apply を実行する
[group('tf')]
tf-apply layer:
    cd infra/{{layer}} && terraform init -input=false -backend-config="bucket=$(cd ../bootstrap && terraform output -raw tfstate_bucket)" && terraform apply
```

- [ ] **Step 6: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/platform && mise exec -- terraform init -input=false -backend=false && mise exec -- terraform validate
```
Expected: `Success! The configuration is valid.`（この時点ではリソースが無いので警告なく通る）

- [ ] **Step 7: Commit**

```bash
git add infra/platform/versions.tf infra/platform/providers.tf infra/platform/variables.tf infra/platform/data.tf justfile
git commit -m "feat(infra): platform層の骨格とbackend配線を追加"
```

---

## Task 2: S3（アプリ用オブジェクト格納バケット）

**Files:**
- Create: `infra/platform/s3.tf`

**Interfaces:**
- Consumes: `var.project_name`（Task 1）, `data.aws_caller_identity.current`（Task 1）
- Produces: `aws_s3_bucket.app`（Task 7 の outputs.tf が参照）

- [ ] **Step 1: s3.tf を作成する**

非公開バケット。常時起動層だが誤操作時に destroy できるよう `force_destroy = true` にする。

```hcl
resource "aws_s3_bucket" "app" {
  bucket = "${var.project_name}-app-${data.aws_caller_identity.current.account_id}"

  force_destroy = true
}

resource "aws_s3_bucket_versioning" "app" {
  bucket = aws_s3_bucket.app.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket = aws_s3_bucket.app.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}
```

- [ ] **Step 2: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/platform && mise exec -- terraform validate
```
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/platform/s3.tf
git commit -m "feat(infra): platform層にアプリ用S3バケットを追加"
```

---

## Task 3: DynamoDB（items テーブル）

**Files:**
- Create: `infra/platform/dynamodb.tf`

**Interfaces:**
- Consumes: `var.project_name`（Task 1）
- Produces: `aws_dynamodb_table.items`（Task 7 の outputs.tf が参照）

- [ ] **Step 1: dynamodb.tf を作成する**

テーブル名 `items`、PK は `id`（String）のみ。items ドメインの属性は M4 以降で固まるが、DynamoDB はスキーマレスなので先に作って困らない。キャパシティ管理を避けるためオンデマンド課金にする。

```hcl
resource "aws_dynamodb_table" "items" {
  name         = "${var.project_name}-items"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}
```

- [ ] **Step 2: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/platform && mise exec -- terraform validate
```
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/platform/dynamodb.tf
git commit -m "feat(infra): platform層にitemsテーブルを追加"
```

---

## Task 4: SQS + DLQ

**Files:**
- Create: `infra/platform/sqs.tf`

**Interfaces:**
- Consumes: `var.project_name`（Task 1）
- Produces: `aws_sqs_queue.items`, `aws_sqs_queue.items_dlq`（Task 7 の outputs.tf が参照）

- [ ] **Step 1: sqs.tf を作成する**

`visibility_timeout_seconds = 30`、`maxReceiveCount = 3` で DLQ に送る。

```hcl
resource "aws_sqs_queue" "items_dlq" {
  name = "${var.project_name}-items-dlq"
}

resource "aws_sqs_queue" "items" {
  name                       = "${var.project_name}-items"
  visibility_timeout_seconds = 30

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.items_dlq.arn
    maxReceiveCount      = 3
  })
}
```

- [ ] **Step 2: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/platform && mise exec -- terraform validate
```
Expected: `Success! The configuration is valid.`（`terraform fmt` が `redrive_policy` 内の揃えを自動整形する）

- [ ] **Step 3: Commit**

```bash
git add infra/platform/sqs.tf
git commit -m "feat(infra): platform層にSQS+DLQを追加"
```

---

## Task 5: ECR（api/worker 共用リポジトリ）

**Files:**
- Create: `infra/platform/ecr.tf`

**Interfaces:**
- Consumes: `var.project_name`（Task 1）
- Produces: `aws_ecr_repository.app`（Task 7 の outputs.tf が参照）

- [ ] **Step 1: ecr.tf を作成する**

api と worker は1イメージで共用するためリポジトリは1つ。`latest` タグを使わない方針（commit SHA タグ）に合わせ `IMMUTABLE` にする。lifecycle policy で最新10個のみ保持。

```hcl
resource "aws_ecr_repository" "app" {
  name                 = var.project_name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "最新10個のイメージのみ保持する"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
```

- [ ] **Step 2: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/platform && mise exec -- terraform validate
```
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/platform/ecr.tf
git commit -m "feat(infra): platform層にECRリポジトリを追加"
```

---

## Task 6: Secrets Manager（アプリ用シークレット）

**Files:**
- Create: `infra/platform/secrets.tf`

**Interfaces:**
- Consumes: `var.project_name`（Task 1）
- Produces: `aws_secretsmanager_secret.app`（Task 7 の outputs.tf が参照。値は outputs に出さない）

- [ ] **Step 1: secrets.tf を作成する**

外部 API キー相当のプレースホルダ。実際のキー値は持たず、ダミー値を入れる。destroy で確実に消えるよう `recovery_window_in_days = 0`。

```hcl
resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.project_name}/app"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    api_key = "REPLACE_ME"
  })
}
```

- [ ] **Step 2: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/platform && mise exec -- terraform validate
```
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/platform/secrets.tf
git commit -m "feat(infra): platform層にアプリ用シークレットを追加"
```

---

## Task 7: outputs.tf / README.md / tflint 最終確認

**Files:**
- Create: `infra/platform/outputs.tf`
- Create: `infra/platform/README.md`

**Interfaces:**
- Consumes: Task 2〜6 の全リソース

- [ ] **Step 1: outputs.tf を作成する**

秘匿値（シークレットの中身）は出力しない。ARN / ID / エンドポイントのみ。

```hcl
output "app_bucket" {
  description = "アプリ用オブジェクト格納バケット名。"
  value       = aws_s3_bucket.app.bucket
}

output "app_bucket_arn" {
  description = "アプリ用バケットの ARN。"
  value       = aws_s3_bucket.app.arn
}

output "items_table_name" {
  description = "items DynamoDB テーブル名。"
  value       = aws_dynamodb_table.items.name
}

output "items_queue_url" {
  description = "items SQS キューの URL。"
  value       = aws_sqs_queue.items.url
}

output "items_dlq_url" {
  description = "items DLQ の URL。"
  value       = aws_sqs_queue.items_dlq.url
}

output "ecr_repository_url" {
  description = "api/worker 共用 ECR リポジトリの URL。"
  value       = aws_ecr_repository.app.repository_url
}

output "app_secret_arn" {
  description = "アプリ用シークレットの ARN（値そのものは出力しない）。"
  value       = aws_secretsmanager_secret.app.arn
}

output "aws_region" {
  description = "全層で共通のリージョン。"
  value       = var.aws_region
}
```

- [ ] **Step 2: README.md を作成する**

`infra/bootstrap/README.md` の構成（概要 / 依存 / 出力表 / 注意）に倣う。

```markdown
# platform

常時起動する土台リソースを作る層。S3（アプリ用オブジェクト）、DynamoDB（`items` テーブル）、SQS+DLQ、ECR（api/worker 共用）、アプリ用シークレットを持つ。

## 依存

- `infra/bootstrap/`（tfstate バケット。`just tf-plan platform` / `just tf-apply platform` が `-backend-config` で自動的に配線する）

## 出力

| 名前 | 用途 |
|---|---|
| `app_bucket` | アプリ用オブジェクト格納バケット名 |
| `app_bucket_arn` | 同バケットの ARN |
| `items_table_name` | items DynamoDB テーブル名 |
| `items_queue_url` | items SQS キューの URL |
| `items_dlq_url` | items DLQ の URL |
| `ecr_repository_url` | api/worker 共用 ECR リポジトリの URL |
| `app_secret_arn` | アプリ用シークレットの ARN（値は含まない） |
| `aws_region` | 全層で共通のリージョン |

## 注意

- **GitHub OIDC provider/role はこの層には無い。** 使うタイミング（M8, CI/CD）に合わせて作るため、まだ追加していない
- アプリ用シークレットの値はダミー（`REPLACE_ME`）。実際の外部 API キーは持たない
- ECR は `image_tag_mutability = "IMMUTABLE"`。`latest` タグは使わず commit SHA でタグ付けする運用（M8）に合わせている
- 常時起動層なので `just down` の対象外
```

- [ ] **Step 3: 全体の fmt / tflint / validate を実行する**

Run:
```bash
just tf-fmt
cd infra && mise exec -- tflint --recursive
cd infra/platform && mise exec -- terraform validate
```
Expected: tflint・validate ともにエラーなし。

- [ ] **Step 4: Commit**

```bash
git add infra/platform/outputs.tf infra/platform/README.md
git commit -m "docs(infra): platform層のoutputsとREADMEを追加"
```

---

## Task 8: terraform apply（実 AWS リソース作成・ユーザー承認必須）

**このタスクは課金対象の実 AWS リソースを作成する。plan の内容をユーザーに提示し、明示的な承認を得てから apply すること。**

**Files:** なし（Task 1〜7 で作成した `infra/platform/` を対象に実行するのみ）

- [ ] **Step 1: SSO 認証を確認する**

Run: `mise exec -- aws sts get-caller-identity`
Expected: アカウント情報が JSON で返る（失効していたら `aws sso login --profile personal` をユーザーに依頼する）

- [ ] **Step 2: plan を実行して内容を確認する**

Run: `just tf-plan platform`
Expected: `Plan: 12 to add, 0 to change, 0 to destroy.`（S3系5 + DynamoDB1 + SQS2 + ECR2 + Secrets2 = 12 リソース）付近の値になる。実際の数を確認し、想定外の diff が無いことを確認する。

- [ ] **Step 3: ユーザーに plan 内容を提示し、apply の承認を得る**

plan の要約（作成されるリソース一覧、想定コスト ~$1/月）をユーザーに提示し、明示的な「はい」を得るまで次のステップに進まない。

- [ ] **Step 4: apply を実行する**

Run: `just tf-apply platform`
Expected: `Apply complete! Resources: 12 added, 0 changed, 0 destroyed.`

- [ ] **Step 5: outputs を確認する**

Run: `cd infra/platform && mise exec -- terraform output`
Expected: Task 7 で定義した8つの output がすべて値を持って表示される（`app_secret_arn` は ARN のみでシークレットの値は出ない）。

- [ ] **Step 6: Commit**

apply 後に生成されるファイルはない（state は S3 backend にあり、ローカルに tfstate ファイルは残らない）。`infra/platform/.terraform/` はコミット対象外（`.gitignore` 済み）なので、このタスクではコミットするファイルが無ければ何もしない。

---

## Task 9: `@repo/core` — S3 クライアントラッパー

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/s3.ts`
- Create: `packages/core/src/s3.test.ts`

**Interfaces:**
- Produces: `putObject(bucket: string, key: string, body: string): Promise<void>`, `getObject(bucket: string, key: string): Promise<string>`（Task 13 の index.ts が re-export）

- [ ] **Step 1: AWS SDK 依存を追加する**

Run:
```bash
pnpm --filter @repo/core add @aws-sdk/client-s3 @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-sqs @aws-sdk/client-secrets-manager
pnpm --filter @repo/core add -D aws-sdk-client-mock @smithy/util-stream
```

（本タスクでは S3 分だけ使うが、Task 10〜12 で使う残りの SDK もまとめてここで入れておく）

- [ ] **Step 2: 失敗するテストを書く**

`packages/core/src/s3.test.ts`:

```typescript
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it } from 'vitest';
import { getObject, putObject } from './s3.ts';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

describe('putObject', () => {
  it('指定した bucket / key / body で PutObjectCommand を呼ぶ', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    await putObject('my-bucket', 'my-key', 'hello');

    expect(s3Mock.commandCalls(PutObjectCommand)[0]?.args[0].input).toEqual({
      Bucket: 'my-bucket',
      Key: 'my-key',
      Body: 'hello',
    });
  });
});

describe('getObject', () => {
  it('オブジェクトの中身を文字列として返す', async () => {
    const stream = sdkStreamMixin(Readable.from(['hello']));
    s3Mock.on(GetObjectCommand).resolves({ Body: stream });

    const result = await getObject('my-bucket', 'my-key');

    expect(result).toBe('hello');
  });

  it('Body が無い場合はエラーを投げる', async () => {
    s3Mock.on(GetObjectCommand).resolves({});

    await expect(getObject('my-bucket', 'my-key')).rejects.toThrow(
      'S3 object body is empty: s3://my-bucket/my-key',
    );
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `pnpm --filter @repo/core test`
Expected: FAIL（`./s3.ts` が存在しない）

- [ ] **Step 4: 実装する**

`packages/core/src/s3.ts`:

```typescript
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const client = new S3Client({});

export async function putObject(bucket: string, key: string, body: string): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
}

export async function getObject(bucket: string, key: string): Promise<string> {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await result.Body?.transformToString();
  if (body === undefined) {
    throw new Error(`S3 object body is empty: s3://${bucket}/${key}`);
  }
  return body;
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `pnpm --filter @repo/core test`
Expected: PASS（3 tests）

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/pnpm-lock.yaml packages/core/src/s3.ts packages/core/src/s3.test.ts
git commit -m "feat(core): S3クライアントラッパーを追加"
```

---

## Task 10: `@repo/core` — DynamoDB クライアントラッパー

**Files:**
- Create: `packages/core/src/dynamodb.ts`
- Create: `packages/core/src/dynamodb.test.ts`

**Interfaces:**
- Consumes: Task 9 の `aws-sdk-client-mock` 依存
- Produces: `putItem(tableName: string, item: Record<string, unknown>): Promise<void>`, `getItem(tableName: string, key: Record<string, unknown>): Promise<Record<string, unknown> | undefined>`（Task 13 の index.ts が re-export）

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/dynamodb.test.ts`:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getItem, putItem } from './dynamodb.ts';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('putItem', () => {
  it('指定した table / item で PutCommand を呼ぶ', async () => {
    ddbMock.on(PutCommand).resolves({});

    await putItem('items', { id: '1', name: 'test' });

    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: 'items',
      Item: { id: '1', name: 'test' },
    });
  });
});

describe('getItem', () => {
  it('該当する item を返す', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { id: '1', name: 'test' } });

    const result = await getItem('items', { id: '1' });

    expect(result).toEqual({ id: '1', name: 'test' });
  });

  it('該当する item が無い場合は undefined を返す', async () => {
    ddbMock.on(GetCommand).resolves({});

    const result = await getItem('items', { id: 'missing' });

    expect(result).toBeUndefined();
  });
});
```

DynamoDBClient のコンストラクタ実引数は `DynamoDBClient` 自身であり、`mockClient(DynamoDBDocumentClient)` は `DynamoDBDocumentClient.from()` 経由の呼び出しをインターセプトする（aws-sdk-client-mock の標準サポート）。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm --filter @repo/core test`
Expected: FAIL（`./dynamodb.ts` が存在しない）

- [ ] **Step 3: 実装する**

`packages/core/src/dynamodb.ts`:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function putItem(tableName: string, item: Record<string, unknown>): Promise<void> {
  await client.send(new PutCommand({ TableName: tableName, Item: item }));
}

export async function getItem(
  tableName: string,
  key: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const result = await client.send(new GetCommand({ TableName: tableName, Key: key }));
  return result.Item;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm --filter @repo/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/dynamodb.ts packages/core/src/dynamodb.test.ts
git commit -m "feat(core): DynamoDBクライアントラッパーを追加"
```

---

## Task 11: `@repo/core` — SQS クライアントラッパー

**Files:**
- Create: `packages/core/src/sqs.ts`
- Create: `packages/core/src/sqs.test.ts`

**Interfaces:**
- Consumes: Task 9 の `aws-sdk-client-mock` 依存
- Produces: `sendMessage(queueUrl: string, body: string): Promise<string>`, `ReceivedMessage { receiptHandle: string; body: string }`, `receiveMessages(queueUrl: string): Promise<ReceivedMessage[]>`, `deleteMessage(queueUrl: string, receiptHandle: string): Promise<void>`（Task 13 の index.ts が re-export）

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/sqs.test.ts`:

```typescript
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteMessage, receiveMessages, sendMessage } from './sqs.ts';

const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  sqsMock.reset();
});

describe('sendMessage', () => {
  it('MessageId を返す', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-1' });

    const result = await sendMessage('https://queue.example/items', 'hello');

    expect(result).toBe('msg-1');
    expect(sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input).toEqual({
      QueueUrl: 'https://queue.example/items',
      MessageBody: 'hello',
    });
  });

  it('MessageId が無い場合はエラーを投げる', async () => {
    sqsMock.on(SendMessageCommand).resolves({});

    await expect(sendMessage('https://queue.example/items', 'hello')).rejects.toThrow(
      'SQS did not return a MessageId',
    );
  });
});

describe('receiveMessages', () => {
  it('受信したメッセージを receiptHandle / body の配列に変換する', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [{ MessageId: 'msg-1', ReceiptHandle: 'handle-1', Body: 'hello' }],
    });

    const result = await receiveMessages('https://queue.example/items');

    expect(result).toEqual([{ receiptHandle: 'handle-1', body: 'hello' }]);
  });

  it('メッセージが無い場合は空配列を返す', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({});

    const result = await receiveMessages('https://queue.example/items');

    expect(result).toEqual([]);
  });
});

describe('deleteMessage', () => {
  it('指定した queueUrl / receiptHandle で DeleteMessageCommand を呼ぶ', async () => {
    sqsMock.on(DeleteMessageCommand).resolves({});

    await deleteMessage('https://queue.example/items', 'handle-1');

    expect(sqsMock.commandCalls(DeleteMessageCommand)[0]?.args[0].input).toEqual({
      QueueUrl: 'https://queue.example/items',
      ReceiptHandle: 'handle-1',
    });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm --filter @repo/core test`
Expected: FAIL（`./sqs.ts` が存在しない）

- [ ] **Step 3: 実装する**

`packages/core/src/sqs.ts`:

```typescript
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

const client = new SQSClient({});

export async function sendMessage(queueUrl: string, body: string): Promise<string> {
  const result = await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
  if (result.MessageId === undefined) {
    throw new Error(`SQS did not return a MessageId for queue: ${queueUrl}`);
  }
  return result.MessageId;
}

export interface ReceivedMessage {
  receiptHandle: string;
  body: string;
}

export async function receiveMessages(queueUrl: string): Promise<ReceivedMessage[]> {
  const result = await client.send(
    new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 5 }),
  );
  return (result.Messages ?? []).map((message) => {
    if (message.ReceiptHandle === undefined || message.Body === undefined) {
      throw new Error(`SQS message is missing ReceiptHandle or Body: ${JSON.stringify(message)}`);
    }
    return { receiptHandle: message.ReceiptHandle, body: message.Body };
  });
}

export async function deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
  await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm --filter @repo/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sqs.ts packages/core/src/sqs.test.ts
git commit -m "feat(core): SQSクライアントラッパーを追加"
```

---

## Task 12: `@repo/core` — Secrets Manager クライアントラッパー

**Files:**
- Create: `packages/core/src/secrets.ts`
- Create: `packages/core/src/secrets.test.ts`

**Interfaces:**
- Consumes: Task 9 の `aws-sdk-client-mock` 依存
- Produces: `getSecretValue(secretId: string): Promise<string>`（Task 13 の index.ts が re-export）

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/secrets.test.ts`:

```typescript
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSecretValue } from './secrets.ts';

const secretsMock = mockClient(SecretsManagerClient);

beforeEach(() => {
  secretsMock.reset();
});

describe('getSecretValue', () => {
  it('SecretString を返す', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: '{"api_key":"dummy"}' });

    const result = await getSecretValue('learn-aws-saas-ts/app');

    expect(result).toBe('{"api_key":"dummy"}');
    expect(secretsMock.commandCalls(GetSecretValueCommand)[0]?.args[0].input).toEqual({
      SecretId: 'learn-aws-saas-ts/app',
    });
  });

  it('SecretString が無い場合はエラーを投げる', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({});

    await expect(getSecretValue('learn-aws-saas-ts/app')).rejects.toThrow(
      'secret has no string value: learn-aws-saas-ts/app',
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm --filter @repo/core test`
Expected: FAIL（`./secrets.ts` が存在しない）

- [ ] **Step 3: 実装する**

`packages/core/src/secrets.ts`:

```typescript
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});

export async function getSecretValue(secretId: string): Promise<string> {
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (result.SecretString === undefined) {
    throw new Error(`secret has no string value: ${secretId}`);
  }
  return result.SecretString;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm --filter @repo/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/secrets.ts packages/core/src/secrets.test.ts
git commit -m "feat(core): Secrets Managerクライアントラッパーを追加"
```

---

## Task 13: index.ts の re-export と実 AWS への手動動作確認

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Task 9〜12 の全 export

- [ ] **Step 1: index.ts に re-export を追加する**

`packages/core/src/index.ts`:

```typescript
export * from './health.ts';
export * from './s3.ts';
export * from './dynamodb.ts';
export * from './sqs.ts';
export * from './secrets.ts';
```

- [ ] **Step 2: 型チェックとテストを実行する**

Run: `just typecheck && just test`
Expected: 両方 PASS

- [ ] **Step 3: build して dist に反映する**

Run: `pnpm --filter @repo/core build`
Expected: `packages/core/dist/` に `s3.js` / `dynamodb.js` / `sqs.js` / `secrets.js` とその `.d.ts` が生成される

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): S3/DynamoDB/SQS/Secretsのクライアントラッパーをindexからre-exportする"
```

- [ ] **Step 5: 実 AWS への手動動作確認**

Task 8 で apply 済みの `infra/platform/` から実際の識別子を取得し、一時スクリプトで各関数を実行する。**このステップはユニットテストではなく手動の受け入れ確認であり、動作確認後にスクリプトは削除してコミットしない。**

`packages/core/verify-m1.ts`（一時ファイル）:

```typescript
import { getObject, putObject } from './src/s3.ts';
import { getItem, putItem } from './src/dynamodb.ts';
import { deleteMessage, receiveMessages, sendMessage } from './src/sqs.ts';
import { getSecretValue } from './src/secrets.ts';

const bucket = process.env.APP_BUCKET;
const table = process.env.ITEMS_TABLE;
const queueUrl = process.env.ITEMS_QUEUE_URL;
const secretId = process.env.APP_SECRET_ARN;

if (bucket === undefined || table === undefined || queueUrl === undefined || secretId === undefined) {
  throw new Error('set APP_BUCKET / ITEMS_TABLE / ITEMS_QUEUE_URL / APP_SECRET_ARN (see: terraform output -json in infra/platform)');
}

await putObject(bucket, 'verify.txt', 'hello from M1 verify script');
console.log('S3 put/get:', await getObject(bucket, 'verify.txt'));

await putItem(table, { id: 'verify', message: 'hello from M1 verify script' });
console.log('DynamoDB put/get:', await getItem(table, { id: 'verify' }));

const messageId = await sendMessage(queueUrl, 'hello from M1 verify script');
console.log('SQS send:', messageId);
const messages = await receiveMessages(queueUrl);
console.log('SQS receive:', messages);
for (const message of messages) {
  await deleteMessage(queueUrl, message.receiptHandle);
}

console.log('Secrets Manager get:', await getSecretValue(secretId));
```

Run:
```bash
cd infra/platform
export APP_BUCKET=$(mise exec -- terraform output -raw app_bucket)
export ITEMS_TABLE=$(mise exec -- terraform output -raw items_table_name)
export ITEMS_QUEUE_URL=$(mise exec -- terraform output -raw items_queue_url)
export APP_SECRET_ARN=$(mise exec -- terraform output -raw app_secret_arn)
cd ../../packages/core
mise exec -- node --experimental-strip-types verify-m1.ts
```

Expected:
- `S3 put/get: hello from M1 verify script`
- `DynamoDB put/get: { id: 'verify', message: 'hello from M1 verify script' }`
- `SQS send: <messageId>`
- `SQS receive: [ { receiptHandle: '...', body: 'hello from M1 verify script' } ]`
- `Secrets Manager get: {"api_key":"REPLACE_ME"}`

すべて成功したら:

```bash
rm packages/core/verify-m1.ts
```

（一時ファイルなのでコミットしない）

---

## 完了条件（spec の M1 検証方法）

- [ ] ローカルから S3 put / DynamoDB put / SQS send-receive / Secrets Manager get が成功する（Task 13, Step 5 で確認済み）

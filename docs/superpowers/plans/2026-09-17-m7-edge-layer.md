# M7: edge層（S3 + CloudFrontで本番配信） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `infra/edge/` にフロント配信用の非公開S3バケットとCloudFront（OAC・2オリジン）を実装し、`apps/web` のビルド成果物をCloudFront経由でブラウザから開けるようにする。`/api/*` はALBへ、それ以外はS3（SPA）へ振り分け、CloudFrontのURLを開いてログイン・一覧・作成が動くこと、リロードしてもSPAが404にならないことを実機で確認する。

**Architecture:** `infra/edge/` は常時起動層（`infra/platform/` と同じ）として実装し、`infra/app/`（セッション毎）が出力する ALB DNS 名は `terraform_remote_state` ではなく `var.alb_dns_name`（デフォルト空文字）で受け取る。CloudFrontの `/api/*` オリジンとキャッシュビヘイビアは `dynamic` ブロックで包み、空文字のときは何も作らない。`just up`/`just down`（既にedgeを組み込み済み）が「appの後にedgeをALB DNS付きで再apply」「appをdestroyする前にedgeをALB DNS空で再apply」を担う。S3バケットはOAC（Origin Access Control）経由でのみCloudFrontからアクセスでき、直接の公開アクセスはブロックする。マネージドのキャッシュ/オリジンリクエストポリシーは `aws_cloudfront_cache_policy`/`aws_cloudfront_origin_request_policy` のdata sourceで名前引きし、IDをハードコードしない。

**Tech Stack:** Terraform 1.15.8, AWS provider `~> 6.0` / CloudFront (OAC, 2オリジン) / S3 / Vite（既存の `apps/web` ビルド成果物をそのまま配信）

**Spec:** `docs/superpowers/specs/2026-08-15-aws-saas-backend-design.md`（「全体構成」節、「なぜCloudFrontを『常時起動』層に置くか」節、「M7: edge層」節、「検証方法」のM7行、「Terraformのレイヤー分割」表のedge行）

## Global Constraints

- Terraformリソース名はsnake_case・単数形、リソースタイプ名を名前に繰り返さない。`this`/`main`は使わない（例: バケットは`aws_s3_bucket.web`、配信は`aws_cloudfront_distribution.web`）
- providerの`default_tags`で`Project`/`ManagedBy`/`Layer`を全リソースに付与する（`Layer = "edge"`）
- backendはS3のみ、DynamoDBロックテーブルは使わない（`use_lockfile = true`）。`key = "edge/terraform.tfstate"`
- `infra/edge`は他層のリソースを`terraform_remote_state`で読まない。ALBのDNS名は`var.alb_dns_name`（デフォルト空文字）としてCLIから渡す設計（spec「ALBオリジンの扱い」節の理由による）
- `/api/*`のビヘイビアは**キャッシュしない・ヘッダを素通しする**設定にする（キャッシュポリシー`Managed-CachingDisabled`、オリジンリクエストポリシー`Managed-AllViewerExceptHostHeader`）。これを外すと`Authorization`ヘッダが落ちてJWTが届かず全部401になる
- CloudFrontのマネージドポリシーIDはハードコードせず、`aws_cloudfront_cache_policy`/`aws_cloudfront_origin_request_policy`のdata sourceで名前引きする
- S3バケットは非公開（`block_public_acls`等すべて`true`、`object_ownership = "BucketOwnerEnforced"`）。CloudFrontからのアクセスはOAC + バケットポリシーのみで許可する
- Cognitoアプリクライアントの`callback_urls`は追加しない。**M6で直接ログイン（`USER_PASSWORD_AUTH`）を採用しHosted UI/OAuthを使わない設計に確定しているため**、コールバックURLの概念自体が不要（spec「M7」節の該当記述は古い設計案の名残。詳細はSelf-Review Notes参照）
- `apps/web`のビルドは既存の`.env.local`（`VITE_COGNITO_CLIENT_ID`/`VITE_AWS_REGION`）をそのまま使う。CI/CDでの自動デプロイ配線はM8のスコープなので、本タスクでは手動デプロイ（`just web-deploy`）のみ実装する
- TFLintは`just tf-lint`で回す
- **実AWSへの`apply`はいずれも課金・破壊的操作ではないもの（edge単体は常時起動でコストほぼ$0）を含め、`network`/`data`/`app`を伴うapplyは課金操作なので、実行前に必ずユーザーの明示的な承認を得る**（Task 6, 7, 8）

---

## Task 1: `infra/edge` の骨格（versions / providers / variables / data）

**Files:**
- Create: `infra/edge/versions.tf`
- Create: `infra/edge/providers.tf`
- Create: `infra/edge/variables.tf`
- Create: `infra/edge/data.tf`

**Interfaces:**
- Produces: `var.aws_region` / `var.project_name` / `var.alb_dns_name`（デフォルト空文字）、`data.aws_caller_identity.current`、CloudFrontのマネージドポリシーdata source（`data.aws_cloudfront_cache_policy.caching_optimized` / `data.aws_cloudfront_cache_policy.caching_disabled` / `data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header`）。Task 2/3が使う

- [ ] **Step 1: `versions.tf` を作成する**

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

- [ ] **Step 2: `providers.tf` を作成する**

```hcl
terraform {
  backend "s3" {
    key          = "edge/terraform.tfstate"
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
      Layer     = "edge"
    }
  }
}
```

- [ ] **Step 3: `variables.tf` を作成する**

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

variable "alb_dns_name" {
  description = "app層のALBのDNS名。空文字なら /api/* オリジンとビヘイビアを作らない（app層が未apply/destroy済みのときのデフォルト）。`just up` がapp層apply後にこの値付きでedgeを再applyする。"
  type        = string
  default     = ""
}
```

- [ ] **Step 4: `data.tf` を作成する**

```hcl
data "aws_caller_identity" "current" {}

# マネージドポリシーのIDはハードコードせず名前引きする。
# CachingDisabled: /api/* をキャッシュしない。
# CachingOptimized: S3オリジン（SPA本体）はブラウザキャッシュに任せる標準設定。
# AllViewerExceptHostHeader: Authorization等のヘッダをALBへ素通しする
# （Hostヘッダだけ除外しないとALBがCloudFrontのドメイン名をHostとして受け取り混乱する）。
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host_header" {
  name = "Managed-AllViewerExceptHostHeader"
}
```

- [ ] **Step 5: 単独でvalidateできることを確認する**

Run: `cd infra/edge && mise exec -- terraform init -backend=false && mise exec -- terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
git add infra/edge/versions.tf infra/edge/providers.tf infra/edge/variables.tf infra/edge/data.tf
git commit -m "feat(infra): edge層の骨格（versions/providers/variables/data）を追加する"
```

---

## Task 2: `infra/edge` のS3バケット（フロント配信用・非公開）

**Files:**
- Create: `infra/edge/s3.tf`

**Interfaces:**
- Produces: `aws_s3_bucket.web`（Task 3のCloudFrontオリジン、Task 4のoutputsが参照する）

- [ ] **Step 1: `s3.tf` を実装する**

`infra/platform/s3.tf`（アプリ用バケット）と同じ構成要素を踏襲する。フロント配信用なのでバケット名は`-web-`を使う:

```hcl
resource "aws_s3_bucket" "web" {
  bucket = "${var.project_name}-web-${data.aws_caller_identity.current.account_id}"

  # ビルド成果物はいつでも再生成できるため、destroy時の残留を避けて force_destroy にする。
  force_destroy = true
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
```

- [ ] **Step 2: 単独でvalidateできることを確認する**

Run: `cd infra/edge && mise exec -- terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/edge/s3.tf
git commit -m "feat(infra): edge層にフロント配信用の非公開S3バケットを追加する"
```

---

## Task 3: `infra/edge` のCloudFront（OAC・2オリジン・SPAフォールバック）

**Files:**
- Create: `infra/edge/cloudfront.tf`

**Interfaces:**
- Consumes: `aws_s3_bucket.web`（Task 2）、`data.aws_cloudfront_cache_policy.*` / `data.aws_cloudfront_origin_request_policy.*`（Task 1）、`var.alb_dns_name`（Task 1）
- Produces: `aws_cloudfront_distribution.web`（Task 4のoutputsが参照する）

- [ ] **Step 1: OACとバケットポリシーを実装する**

`infra/edge/cloudfront.tf` の先頭に追加する:

```hcl
resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project_name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront（このdistributionからのみ）にGetObjectを許可する。バケット自体は非公開のまま。
data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "AllowCloudFrontServicePrincipal"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}
```

- [ ] **Step 2: CloudFront distributionを実装する**

同じファイルに追加する:

```hcl
resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${var.project_name} web"

  origin {
    origin_id                = "s3-web"
    domain_name               = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # app層が未apply（var.alb_dns_name空文字）のときは何も作らない。
  # just up がapp層apply後にこの値付きでedgeを再applyすると、
  # distributionの「更新」（作成/削除より速い）としてこのブロックが追加される。
  dynamic "origin" {
    for_each = var.alb_dns_name != "" ? [var.alb_dns_name] : []
    content {
      origin_id   = "alb-api"
      domain_name = origin.value

      custom_origin_config {
        http_port              = 80
        https_port              = 443
        origin_protocol_policy = "http-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods         = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id         = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  dynamic "ordered_cache_behavior" {
    for_each = var.alb_dns_name != "" ? [var.alb_dns_name] : []
    content {
      path_pattern             = "/api/*"
      target_origin_id         = "alb-api"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods           = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      cache_policy_id           = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
    }
  }

  # SPAはルーティングライブラリを使わない単一ページだが、
  # OAC配下のS3は存在しないオブジェクトに403を返す（404ではない）ため、
  # 両方をindex.htmlにフォールバックさせる。
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
```

- [ ] **Step 3: fmtとvalidateを確認する**

Run: `mise exec -- terraform fmt infra/edge/cloudfront.tf && cd infra/edge && mise exec -- terraform validate`
Expected: `fmt`がインデント崩れを直し（上記コードのアライメントは手書きのため揃っていない箇所がある）、`validate`が`Success!`を返す

- [ ] **Step 4: Commit**

```bash
git add infra/edge/cloudfront.tf
git commit -m "feat(infra): edge層にOAC付きCloudFront（S3 + ALB 2オリジン）を追加する"
```

---

## Task 4: `infra/edge` のoutputs・README

**Files:**
- Create: `infra/edge/outputs.tf`
- Create: `infra/edge/README.md`

**Interfaces:**
- Produces: `web_bucket` / `web_bucket_arn` / `cloudfront_domain_name` / `cloudfront_distribution_id` / `aws_region`（outputs）。Task 5の`just web-deploy`、Task 6以降の実機確認が使う

- [ ] **Step 1: `outputs.tf` を作成する**

```hcl
output "web_bucket" {
  description = "フロント配信用バケット名。`just web-deploy` の sync 先。"
  value       = aws_s3_bucket.web.bucket
}

output "web_bucket_arn" {
  description = "フロント配信用バケットのARN。"
  value       = aws_s3_bucket.web.arn
}

output "cloudfront_domain_name" {
  description = "CloudFrontのドメイン名（*.cloudfront.net）。ブラウザで開くURLはこの値の先頭にhttps://を付けたもの。"
  value       = aws_cloudfront_distribution.web.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID。`just web-deploy` のキャッシュinvalidateで使う。"
  value       = aws_cloudfront_distribution.web.id
}

output "aws_region" {
  description = "全層で共通のリージョン。"
  value       = var.aws_region
}
```

- [ ] **Step 2: `README.md` を作成する**

他層のREADME（`infra/app/README.md`等）に倣い、この層が何を作るか・他層との依存を記す:

```markdown
# edge

常時起動するedge層。フロント配信用の非公開S3バケットと、OAC付きCloudFront（2オリジン）を持つ。

## 依存

- `infra/bootstrap/`（tfstateバケット）
- `infra/app/`（ALBのDNS名。`var.alb_dns_name`として明示的に渡す。`terraform_remote_state`は使わない）

## `var.alb_dns_name` について

app層が未apply、またはdestroy済みのときはこの変数を空文字のままにする（デフォルト）。
`/api/*` のオリジンとキャッシュビヘイビアは空文字なら作られない。

- `just up` はapp層apply後、この層を `terraform apply -var="alb_dns_name=<ALBのDNS名>"` で再applyする
- `just down` はapp層をdestroyする前に、この層を `terraform apply -var="alb_dns_name="` で再applyし、
  distributionが死んだALBを指したまま残らないようにする
- 単独で `just tf-apply edge` する場合、ALBのDNS名を渡したいときは
  `TF_VAR_alb_dns_name="$(cd infra/app && terraform output -raw alb_dns_name)" just tf-apply edge` のように実行する

## CloudFrontのdestroyについて

この層は常時起動なので通常destroyしない。CloudFrontのdistributionはdisable→伝播待ち→削除と進み時間がかかる
（時間課金が無いため消す金銭的な意味もない）。
```

- [ ] **Step 3: fmtとvalidateを確認する**

Run: `mise exec -- terraform fmt infra/edge && cd infra/edge && mise exec -- terraform validate`
Expected: `Success!`

- [ ] **Step 4: Commit**

```bash
git add infra/edge/outputs.tf infra/edge/README.md
git commit -m "docs(infra): edge層のoutputs・READMEを追加する"
```

---

## Task 5: `just web-deploy` レシピを追加する

**Files:**
- Modify: `justfile`
- Modify: `README.md`

**Interfaces:**
- Consumes: `infra/edge`の`web_bucket`/`cloudfront_distribution_id` outputs（Task 4）、`apps/web`の`build`スクリプト（既存）
- Produces: `just web-build` / `just web-deploy`（Task 6以降の実機確認で使う）

- [ ] **Step 1: `justfile` に `web` グループを追加する**

`justfile` の `docker` グループの直前（`# ------ docker ------` コメントの手前）に追加する:

```just
# ------------------------------------------------------------------
# web — apps/web のビルドとedge層への配信
# ------------------------------------------------------------------

# apps/web をビルドする（.env.local の VITE_* を埋め込む）
[group('web')]
web-build:
    pnpm --filter @repo/web build

# ビルド成果物をedge層のS3バケットに同期し、CloudFrontのキャッシュをinvalidateする
[group('web')]
web-deploy: web-build
    aws s3 sync apps/web/dist "s3://$(cd infra/edge && terraform output -raw web_bucket)" --delete
    aws cloudfront create-invalidation --distribution-id "$(cd infra/edge && terraform output -raw cloudfront_distribution_id)" --paths '/*'
```

- [ ] **Step 2: 動作確認（ビルドのみ。デプロイはTask 6以降で実施）**

Run: `just web-build`
Expected: `apps/web/dist/` にビルド成果物が出力される（`index.html`・`assets/`等）

- [ ] **Step 3: `README.md` の「コマンド」表に追記する**

`README.md`の「主なもの」表に1行追加する:

```markdown
| `just web-deploy` | `apps/web` をビルドしてedge層のS3に同期、CloudFrontキャッシュをinvalidate |
```

- [ ] **Step 4: Commit**

```bash
git add justfile README.md
git commit -m "feat: apps/webをedge層に配信するjust web-deployを追加する"
```

---

## Task 6: edge層単体をapplyし、SPA表示を確認する（ユーザー承認必須）

**このタスクは実AWSリソース（S3・CloudFront）を作成する。CloudFrontは常時起動でコストはほぼ$0だが、初回のdistribution作成に15〜30分程度かかる。applyの前にユーザーの明示的な承認を得ること。**

**Files:** なし（検証のみ。判明した挙動は `infra/edge/README.md` に追記する）

- [ ] **Step 1: planを確認する**

Run: `cd infra/edge && mise exec -- terraform init -input=false -backend-config="bucket=$(cd ../bootstrap && terraform output -raw tfstate_bucket)" && mise exec -- terraform plan`
Expected: `Plan: N to add, 0 to change, 0 to destroy.`（S3バケット1 + versioning/SSE/public access block/ownership controls/lifecycle各1 + バケットポリシー1 + OAC1 + CloudFront distribution1 = 概ね9）。`var.alb_dns_name`が空文字なので`/api/*`関連のリソースは含まれないことを確認する

- [ ] **Step 2: ユーザーにplanを提示し、applyの承認を得る**

作成されるリソース一覧とコスト（常時起動だがCloudFrontは時間課金なし、S3も数十セント/月程度）を提示し、明示的な「はい」を得るまで次に進まない。

- [ ] **Step 3: applyを実行する**

Run: `just tf-apply edge`（確認プロンプトが出た場合は承認する）
Expected: `Apply complete!`。distribution自体の`Deployed`状態への伝播は非同期なので、`apply`コマンド自体はこれより早く終わる

- [ ] **Step 4: distributionが`Deployed`になるまで待つ**

Run: `aws cloudfront wait distribution-deployed --id "$(cd infra/edge && terraform output -raw cloudfront_distribution_id)"`
Expected: 数分〜30分程度でエラー無く終了する

- [ ] **Step 5: フロントをデプロイする**

`apps/web/.env.local`が無ければM6の手順（`cp apps/web/.env.template apps/web/.env.local`し`infra/platform`の`terraform output -raw cognito_user_pool_client_id`を`VITE_COGNITO_CLIENT_ID`に設定）で作成する。

Run: `just web-deploy`
Expected: `aws s3 sync`が`upload:`ログを出し、`aws cloudfront create-invalidation`が`Invalidation batch`のJSONを返す

- [ ] **Step 6: ブラウザでSPA表示を確認する**

Run: `cd infra/edge && mise exec -- terraform output -raw cloudfront_domain_name`
Expected: `xxxxxxxxxxxxxx.cloudfront.net`のようなドメイン名が出力される

`https://<出力されたドメイン>` をブラウザで開き、以下を確認する:
1. ログイン画面（`apps/web`のSPA）が表示される（この時点では`apps/api`が無いのでログインしてもAPI呼び出しは失敗する。表示確認のみでよい）
2. 存在しないパス（例 `https://<ドメイン>/nonexistent`）を直接開いてもSPAのログイン画面が表示される（403/404の生レスポンスにならない。custom_error_responseの確認）

- [ ] **Step 7: 実機で判明した挙動をREADMEに追記する**

Step 1〜6で想定と違った点（distributionのDeployed待ち時間の実測、S3同期時のエラー等）があれば`infra/edge/README.md`に追記する。無ければ追記しない。

- [ ] **Step 8: Commit**

```bash
git add infra/edge/README.md
git commit -m "docs(infra): edge層単体apply時の実機検証結果を反映する"
```

（追記が無ければコミットしない）

---

## Task 7: `just up` で通しの動作確認をする（ユーザー承認必須・課金操作）

**このタスクは`network`/`data`/`app`層を含む実AWSリソースを作成し、課金が発生する（spec「想定コスト」節を参照）。applyの前にユーザーの明示的な承認を得ること。**

**Files:** なし（検証のみ）

- [ ] **Step 1: ユーザーに`just up`の実行を確認する**

`network`/`data`/`app`層がまとめてapplyされる（NAT Gateway・RDS・ALB・ECS Fargate等）ことと想定コストを提示し、明示的な「はい」を得るまで次に進まない。

- [ ] **Step 2: イメージが最新か確認し、必要ならpushする**

Run: `git rev-parse --short HEAD`
Expected: 現在のcommit SHAが出力される。`aws ecr describe-images --repository-name "$(cd infra/platform && terraform output -raw ecr_repository_url | cut -d/ -f2)" --image-ids imageTag=<sha>` でこのSHAのイメージがECRに存在するか確認する。無ければ `just image-build && just image-push` を実行する

- [ ] **Step 3: `just up` を実行する**

Run: `TF_VAR_image_tag=<sha> just up`
Expected: `network` → `data` → `app` → `edge`（ALB DNS付き再apply）の順に`Apply complete!`が4回出る

- [ ] **Step 4: ECSサービスが安定するまで待つ**

Run: `aws ecs wait services-stable --cluster "$(cd infra/app && terraform output -raw ecs_cluster_name)" --services learn-aws-saas-ts-api learn-aws-saas-ts-worker`
Expected: エラー無く終了する

- [ ] **Step 5: CloudFront経由で `/api/*` に到達できることを確認する（M7の検証条件）**

distributionの更新（ALBオリジン追加）が伝播するまで数分待つ。

Run:
```bash
DOMAIN="$(cd infra/edge && terraform output -raw cloudfront_domain_name)"
curl -i "https://$DOMAIN/api/items"
```
Expected: `HTTP/2 401`（JWTなし。ALBまで届いている証拠。CloudFrontが403/404を返す場合はdistributionの伝播待ちかオリジン設定を疑う）

- [ ] **Step 6: JWTありで200が返ることを確認する（M7の検証条件）**

M5/M6で作成したテストユーザーを使い、Cognitoから直接トークンを取得する:

```bash
USER_POOL_ID="$(cd infra/platform && terraform output -raw cognito_user_pool_id)"
CLIENT_ID="$(cd infra/platform && terraform output -raw cognito_user_pool_client_id)"
TOKEN=$(aws cognito-idp admin-initiate-auth \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$CLIENT_ID" \
    --auth-flow ADMIN_USER_PASSWORD_AUTH \
    --auth-parameters USERNAME=<email>,PASSWORD=<password> \
    --query 'AuthenticationResult.AccessToken' --output text)

DOMAIN="$(cd infra/edge && terraform output -raw cloudfront_domain_name)"
curl -i "https://$DOMAIN/api/items" -H "Authorization: Bearer $TOKEN"
```
Expected: `HTTP/2 200` と `[]`または既存itemの配列（＝Authorizationヘッダがオリジンリクエストポリシーで素通しされ、401にならない）

- [ ] **Step 7: ブラウザでCloudFront経由の一連の操作を確認する（M7の検証条件）**

`https://<cloudfront_domain_name>` を開き、以下を確認する:
1. ログイン画面が表示される
2. テストユーザーでログインすると一覧画面に切り替わる
3. 「新規作成」フォームでitemを作成すると一覧に反映される
4. ブラウザをリロードしてもSPAが404にならない（ログイン画面に戻るだけで、CloudFront/S3の生エラーページにならない）

- [ ] **Step 8: 実機で判明した挙動をREADMEに追記する**

Step 1〜7で想定と違った点（distribution更新の伝播待ち時間の実測等）があれば`infra/edge/README.md`に追記する。無ければ追記しない。

- [ ] **Step 9: Commit**

```bash
git add infra/edge/README.md
git commit -m "docs(infra): just up通しでのedge層実機検証結果を反映する"
```

（追記が無ければコミットしない）

---

## Task 8: `just down` して消し残しゼロを確認する（ユーザー承認必須）

**このタスクは`network`/`data`/`app`層の実AWSリソースを破壊する（RDSのデータは失われる）。実行前にユーザーの明示的な承認を得ること。edge層自体は常時起動のため破壊しない。**

**Files:** なし（検証のみ）

- [ ] **Step 1: ユーザーに`just down`の実行を確認する**

`network`/`data`/`app`のdestroy（RDSのデータ消失を含む）を提示し、明示的な「はい」を得るまで次に進まない。

- [ ] **Step 2: `just down` を実行する**

Run: `just down`（確認プロンプトが出た場合は承認する）
Expected: `edge`がALB DNS空で再apply（`Apply complete!`）→ `app`/`data`/`network`が順にdestroyされる

- [ ] **Step 3: `just leaks` で消し残しゼロを確認する**

Run: `just leaks`
Expected: NAT Gateway・EC2インスタンス（bastion）・Elastic IP・ALB・RDSが全て空、削除待ちシークレットも無い

- [ ] **Step 4: CloudFront経由で `/api/*` が502等にならず404/403フォールバックすることを確認する（任意）**

Run: `curl -i "https://$(cd infra/edge && terraform output -raw cloudfront_domain_name)/api/items"`
Expected: ALBが無いためオリジン接続エラーになるはずだが、`edge`はALB DNS空で再applyされ`/api/*`ビヘイビア自体が消えているため、デフォルトビヘイビア（S3・SPA）にフォールバックしてログイン画面のHTMLが返る

- [ ] **Step 5: 実機で判明した挙動をREADMEに追記する**

Step 1〜4で想定と違った点があれば`infra/edge/README.md`または`README.md`に追記する。無ければ追記しない。

- [ ] **Step 6: Commit**

```bash
git add infra/edge/README.md README.md
git commit -m "docs(infra): M7のdown後の実機検証結果を反映する"
```

（追記が無ければコミットしない）

---

## Self-Review Notes

- **Spec coverage**: 「M7: edge層」節の4項目のうち3つ（フロント用S3+CloudFront+OAC=Task 2-3、2オリジン構成+SPA用custom_error_response=Task 3、`just up`への組み込み=既存のjustfileがM0時点で対応済みのため変更不要と確認）を実装。**4項目目「Cognitoのコールバック URLをCloudFrontドメインに設定」は実装しない**: この記述はspec作成時点（2026-08-15、M0設計時）の想定で、Hosted UI/OAuthコールバックを使う前提だった。M6実装時（`docs/superpowers/plans/2026-09-16-m6-frontend.md`「設計判断」節）で「認証方式は直接ログイン（USER_PASSWORD_AUTH）。Hosted UI / OAuthは使わない」と確定しており、`infra/platform/cognito.tf`の`aws_cognito_user_pool_client.web`にも`callback_urls`属性は存在しない。コールバックURLという概念自体が不要になっているため、Global Constraintsに明記した上でタスクから除外した
- 「なぜCloudFrontを『常時起動』層に置くか」節の理由1（Cognitoコールバック URLの安定性）は上記の理由で本プロジェクトでは実質適用されないが、理由2（CloudFrontのdestroyが遅く時間課金も無い）は引き続き有効なため、edge層を常時起動層とする設計自体は変更していない
- 「検証方法」のM7行（CloudFrontのURLでSPA表示・同一オリジンの`/api/items`がAuthorizationヘッダ付きで401にならない・リロードでSPAルーティングが404にならない）はTask 6 Step 6・Task 7 Step 5-7で全て確認する
- **型/命名の一貫性**: `aws_s3_bucket.web` / `aws_cloudfront_distribution.web` の命名をTask 2-4で一貫使用。outputs名（`web_bucket` / `cloudfront_domain_name` / `cloudfront_distribution_id`）はTask 4で定義し、Task 5の`justfile`・Task 6-8の検証コマンドで同じ名前をそのまま参照している
- **プレースホルダ無し**: 各StepのTerraformコードは実際に貼り付け可能な完全なコード。マネージドポリシーIDはdata source経由で解決するため、実装時に固定値を調べる必要が無い（spec記載の「実装時に確認する」を、ハードコードではなくdata source参照で解決する形に置き換えた）

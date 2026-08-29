# M3: data層（RDS + SSM踏み台 + Drizzle） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `infra/data/` に RDS PostgreSQL・DB認証情報シークレット・SSM踏み台EC2をTerraformで実装し、`@repo/core` に Drizzle のスキーマ／接続／migration／seed を実装して、SSMポートフォワード経由で migration 済みテーブルが見えるところまでを通しで確認する。

**Architecture:** `infra/network/` に bastion SG を追加（M2の慣習どおりSGという「箱」はnetwork層）した上で、`infra/data/` を新設する。`data/` は `terraform_remote_state` で network 層の subnet ID / SG ID を読み、RDS・`random_password`＋Secrets Manager（recovery window 0）・SSM管理下の t4g.nano bastion を作る。アプリ側は `@repo/core` に Drizzle（`drizzle-orm` + `pg`）の schema / client / seed を置き、`drizzle-kit` の migration をローカルからトンネル越しに流す。

**Tech Stack:** Terraform 1.15.8 / AWS provider `~> 6.0` / hashicorp/random `~> 3.6` / PostgreSQL 17（`db.t4g.micro`）/ Amazon Linux 2023 arm64 / drizzle-orm + drizzle-kit + node-postgres(`pg`) / Vitest

**Spec:** `docs/superpowers/specs/2026-08-15-aws-saas-backend-design.md`（「M3: data 層 — RDS」節、「シークレットと destroy 運用」節、「Terraform のレイヤー分割」節、「検証方法」節のM3行）

## Global Constraints

- Terraformリソース名はsnake_case・単数形、リソースタイプ名を名前に繰り返さない。用途がわかる名前を付ける（`this`/`main`は使わない）
- providerの`default_tags`で`Project`/`ManagedBy`/`Layer`を全リソースに付与する（`Layer = "data"`）
- backendはS3のみ、DynamoDBロックテーブルは使わない（`use_lockfile = true`）。`key = "data/terraform.tfstate"`
- 層間の値は `terraform_remote_state` で読む。tfstateバケット名は `"${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"` で組み立てる（`infra/bootstrap/main.tf` の命名と一致）
- **outputs に秘匿値を出さない。** DBパスワードは `data/` の tfstate と Secrets Manager の中だけに存在する。出力するのは ARN / ID / エンドポイントのみ
- SGルールは1リソース＝1ルール（`aws_vpc_security_group_ingress_rule` / `..._egress_rule`）。`aws_security_group` に inline ブロックを書かない
- `aws_security_group` を inline egress 無しで作るとTerraformはAWS既定の全許可egressを削除する。outboundが必要なSGには明示的に `aws_vpc_security_group_egress_rule` を書く（M2で実証済み）
- DB認証情報は `manage_master_user_password` を使わず、`random_password` + `aws_secretsmanager_secret`（`recovery_window_in_days = 0`）で持つ
- `random_password` の `override_special` は `"!#$%^&*()-_=+[]{}<>:?"`（RDSが禁止する `/` `@` `"` スペースを除外。`validate` は通るが `apply` で落ちる典型）
- RDSは `engine_version = "17"`（メジャーのみ固定）、`storage_encrypted = true`、`skip_final_snapshot = true`、`deletion_protection = false`、`publicly_accessible = false`
- bastion の AMI は `data.aws_ssm_parameter` で `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64` を参照する（`data.aws_ami` の name filter は使わない）
- TFLintは `just tf-lint`（`infra/.tflint.hcl` を絶対パスで `--config` 指定済み）で回す
- TypeScriptは Node 24 の型除去で動く範囲に収める（`enum`・デコレータ・パラメータプロパティ不可、相対importに `.ts` 拡張子必須）
- Biomeのフォーマット規約に従う（シングルクォート、セミコロンあり）。`just lint` は Dockerfile / workflow が未作成のため `hadolint` / `actionlint` の行で落ちる。この計画では `pnpm exec turbo run lint` と `just tf-lint` を個別に使う
- **実AWSへの `apply` / `destroy` はいずれも課金・破壊的操作なので、実行前に必ずユーザーの明示的な承認を得る**（Task 8 / Task 9）

---

## Task 1: network層に bastion SG を追加する

SSM踏み台用のSGという「箱」を、M2の慣習どおり `infra/network/` 側に置く。踏み台の実体（EC2・IAMロール）は Task 4 で `infra/data/` に作る。

**Files:**
- Modify: `infra/network/security_groups.tf`（末尾に bastion SG 群を追加、`rds_from_bastion` ingress も追加）
- Modify: `infra/network/outputs.tf`（`bastion_security_group_id` を追加）
- Modify: `infra/network/README.md`（出力表と注意書きを更新）

**Interfaces:**
- Produces: `aws_security_group.bastion` / network層 output `bastion_security_group_id`（Task 4 の `aws_instance.bastion` が `terraform_remote_state` 経由で参照する）

- [ ] **Step 1: security_groups.tf に bastion SG とルールを追加する**

`infra/network/security_groups.tf` の末尾に追記する。

```hcl
resource "aws_security_group" "bastion" {
  name        = "${var.project_name}-bastion"
  description = "Security group for the SSM bastion host. No ingress; SSM Agent dials out."
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-bastion"
  }
}

# ingress は無い。SSM Session Manager は Agent 側から HTTPS で接続しに行くだけなので、
# 踏み台に対する inbound は一切不要（SSH 鍵も踏み台への 22 番も持たない）。

# SSM Agent が ssm/ssmmessages/ec2messages エンドポイントへ到達するため（NAT Gateway 経由）。
resource "aws_vpc_security_group_egress_rule" "bastion_https" {
  security_group_id = aws_security_group.bastion.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# AWS-StartPortForwardingSessionToRemoteHost は踏み台を起点に RDS へ TCP を張る。
# 素の aws_security_group はデフォルト全許可 egress が削除されるため、
# この 5432 egress が無いとポートフォワードがタイムアウトする。
resource "aws_vpc_security_group_egress_rule" "bastion_to_rds" {
  security_group_id            = aws_security_group.bastion.id
  referenced_security_group_id = aws_security_group.rds.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_bastion" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.bastion.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
```

（設計ドキュメントは bastion の egress を「443 のみ」と書いているが、それは SSM Agent の通信だけを見た記述。ポートフォワードの実体は踏み台→RDS の TCP 接続なので 5432 の egress も要る。この差分は Task 5 の README に記録する。）

- [ ] **Step 2: outputs.tf に bastion_security_group_id を追加する**

`infra/network/outputs.tf` の `rds_security_group_id` の直後に挿入する。

```hcl
output "bastion_security_group_id" {
  description = "SSM 踏み台 EC2 に付与する SG の ID。"
  value       = aws_security_group.bastion.id
}
```

- [ ] **Step 3: fmt / validate / lint を通す**

Run: `just tf-fmt && just tf-validate && just tf-lint`
Expected: いずれもエラー無しで終了する（`tf-validate` は6層すべてで `Success! The configuration is valid.`。`infra/data` はこの時点では空ディレクトリすら無いので、`for` ループが `cd` に失敗しないよう Task 2 より前に `infra/data/` を作っていない場合は `tf-validate` が `data` の行でエラーになる。その場合は Task 2 完了後に再実行してよい）

- [ ] **Step 4: README を更新する**

`infra/network/README.md` の出力表に1行追加する。

```markdown
| `bastion_security_group_id` | M3 で SSM 踏み台 EC2 に付与する SG の ID |
```

「注意」節の「ALB/ECS/RDS 自体のリソースはこの層には無い」の項に、以下を追記する。

```markdown
- **bastion SG もこの層にある。** 踏み台 EC2 の実体（EC2・IAM ロール・instance profile）は `infra/data/` にあり、この層の `bastion_security_group_id` を `terraform_remote_state` 経由で参照する。ingress は持たない（SSM Agent が自分から HTTPS で出ていくだけ）。egress は 443（SSM エンドポイント）と RDS SG 宛て 5432（ポートフォワードの実体）の2本
```

- [ ] **Step 5: Commit**

```bash
git add infra/network/security_groups.tf infra/network/outputs.tf infra/network/README.md
git commit -m "feat(infra): network層にSSM踏み台用SGとRDSへのingressを追加する"
```

---

## Task 2: data層の骨格（versions / providers / variables / data）

`infra/data/` を新設し、他層と同じファイルセットで単独 `plan` できる状態にする。この層は network 層の出力に依存する唯一の層なので、`terraform_remote_state` の配線もここで作る。

**Files:**
- Create: `infra/data/versions.tf`
- Create: `infra/data/providers.tf`
- Create: `infra/data/variables.tf`
- Create: `infra/data/data.tf`

**Interfaces:**
- Consumes: network層 outputs（`private_subnet_ids`, `rds_security_group_id`, `bastion_security_group_id`）
- Produces: `var.aws_region` / `var.project_name` / `var.db_instance_class` / `var.db_engine_version` / `var.db_allocated_storage` / `var.bastion_instance_type`、`data.terraform_remote_state.network`、`data.aws_ssm_parameter.bastion_ami`（Task 3 / Task 4 が参照する）

- [ ] **Step 1: versions.tf を作成する**

他層と同じ内容に `random` provider を足す（`random_password` を使うため）。

```hcl
terraform {
  required_version = ">= 1.15.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
```

- [ ] **Step 2: providers.tf を作成する**

```hcl
terraform {
  backend "s3" {
    key          = "data/terraform.tfstate"
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
      Layer     = "data"
    }
  }
}
```

- [ ] **Step 3: variables.tf を作成する**

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

variable "db_instance_class" {
  description = "RDS のインスタンスクラス。学習用途の最小構成。"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "PostgreSQL のメジャーバージョン。マイナーは AWS に任せる。"
  type        = string
  default     = "17"
}

variable "db_allocated_storage" {
  description = "RDS のストレージ容量（GiB）。gp3 の最小値。"
  type        = number
  default     = 20
}

variable "bastion_instance_type" {
  description = "SSM 踏み台 EC2 のインスタンスタイプ（Graviton の最小）。"
  type        = string
  default     = "t4g.nano"
}
```

- [ ] **Step 4: data.tf を作成する**

```hcl
data "aws_caller_identity" "current" {}

# 層間の配線。tfstate バケット名は infra/bootstrap/main.tf と同じ規則で組み立てる
# （backend 側はバケット名を -backend-config で受け取るが、data source には渡らないため）。
data "terraform_remote_state" "network" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"
    key    = "network/terraform.tfstate"
    region = var.aws_region
  }
}

# AWS が公開する最新の Amazon Linux 2023 arm64 AMI。
# data.aws_ami の name filter は AMI 命名規則の変更で壊れるため使わない。
data "aws_ssm_parameter" "bastion_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}
```

- [ ] **Step 5: fmt / validate を通す**

Run: `just tf-fmt && just tf-validate`
Expected: `infra/data` を含む6層すべてで `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
git add infra/data/versions.tf infra/data/providers.tf infra/data/variables.tf infra/data/data.tf
git commit -m "feat(infra): data層の骨格とnetwork層へのremote state配線を追加する"
```

---

## Task 3: RDS PostgreSQL とDB認証情報シークレット

subnet group / parameter group / `random_password` / Secrets Manager / DBインスタンスを作る。

**Files:**
- Create: `infra/data/rds.tf`
- Create: `infra/data/secrets.tf`

**Interfaces:**
- Consumes: `data.terraform_remote_state.network.outputs.private_subnet_ids` / `...rds_security_group_id`、`var.db_*`
- Produces: `aws_db_instance.app`（`.address` / `.port` / `.db_name` / `.username` / `.identifier`）、`aws_secretsmanager_secret.db`（Task 5 の outputs と Task 6 の justfile が参照）

- [ ] **Step 1: rds.tf を作成する**

```hcl
resource "aws_db_subnet_group" "app" {
  name        = "${var.project_name}-app"
  description = "Private subnets for the app database."
  subnet_ids  = data.terraform_remote_state.network.outputs.private_subnet_ids

  tags = {
    Name = "${var.project_name}-app"
  }
}

# 空の箱にせず、クライアント接続の TLS を強制する。
# rds.force_ssl は静的パラメータなので apply_method = "pending-reboot"（新規作成時はそのまま有効になる）。
resource "aws_db_parameter_group" "app" {
  name        = "${var.project_name}-app"
  description = "Parameter group for the app database. Forces TLS."
  family      = "postgres${var.db_engine_version}"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  tags = {
    Name = "${var.project_name}-app"
  }
}

resource "aws_db_instance" "app" {
  identifier     = "${var.project_name}-app"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  # admin / postgres のような推測されやすい名前を避ける。
  db_name  = "app"
  username = "app"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.app.name
  parameter_group_name   = aws_db_parameter_group.app.name
  vpc_security_group_ids = [data.terraform_remote_state.network.outputs.rds_security_group_id]
  publicly_accessible    = false
  multi_az               = false

  # セッション毎に destroy する学習環境。データは消える前提で、状態を決定的にする。
  skip_final_snapshot     = true
  deletion_protection     = false
  backup_retention_period = 0
  apply_immediately       = true

  tags = {
    Name = "${var.project_name}-app"
  }
}
```

- [ ] **Step 2: secrets.tf を作成する**

```hcl
# RDS のマスターパスワードは / @ " スペースを禁止する。
# デフォルトの override_special にはこれらが含まれ、validate は通るが apply で落ちる。
resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%^&*()-_=+[]{}<>:?"
}

# manage_master_user_password は使わない。RDS 所有のシークレットは Terraform リソースとして
# 持てず recovery window を制御できないため、just down のたびに削除待ちシークレットが
# $0.40/月 ずつ残る恐れがある。自前で持てば recovery_window_in_days = 0 で確実に消える。
resource "aws_secretsmanager_secret" "db" {
  name                    = "${var.project_name}/db"
  description             = "Connection info for the app database. Recreated every session."
  recovery_window_in_days = 0
}

# platform 層の app シークレットと違い ignore_changes は付けない。
# ここは random_password が Terraform 管理下にあり Terraform 側が正なので、
# ignore_changes を付けるとローテーション後に古いパスワードで固定されてしまう。
resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    host     = aws_db_instance.app.address
    port     = aws_db_instance.app.port
    dbname   = aws_db_instance.app.db_name
    username = aws_db_instance.app.username
    password = random_password.db.result
  })
}
```

- [ ] **Step 3: fmt / validate / lint を通す**

Run: `just tf-fmt && just tf-validate && just tf-lint`
Expected: エラー無し。TFLint が `aws_db_instance` に対して警告を出した場合は内容を確認し、設計意図（バックアップ無し・シングルAZ・学習用途）に反しない範囲で対応する。抑止する場合はコメントで理由を書く。

- [ ] **Step 4: Commit**

```bash
git add infra/data/rds.tf infra/data/secrets.tf
git commit -m "feat(infra): data層にRDS PostgreSQLとDB認証情報シークレットを追加する"
```

---

## Task 4: SSM踏み台EC2（IAMロール + instance profile + EC2）

`AWS-StartPortForwardingSessionToRemoteHost` の起点になる t4g.nano を private subnet に置く。SSH鍵なし・パブリックIPなし・inbound無し。

**Files:**
- Create: `infra/data/bastion.tf`

**Interfaces:**
- Consumes: `data.aws_ssm_parameter.bastion_ami`、`data.terraform_remote_state.network.outputs.private_subnet_ids` / `...bastion_security_group_id`、`var.bastion_instance_type`
- Produces: `aws_instance.bastion`（`.id` を Task 5 の output `bastion_instance_id` が公開する）

- [ ] **Step 1: bastion.tf を作成する**

```hcl
data "aws_iam_policy_document" "bastion_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bastion" {
  name               = "${var.project_name}-bastion"
  description        = "Role for the SSM bastion host. SSM core access only."
  assume_role_policy = data.aws_iam_policy_document.bastion_assume_role.json
}

# 付けるのは AmazonSSMManagedInstanceCore のみ。踏み台は SSM の管理対象になる以外の権限を持たない。
resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  name = "${var.project_name}-bastion"
  role = aws_iam_role.bastion.name
}

# private subnet に置き、パブリック IP も SSH 鍵も持たない。
# SSM Agent は NAT Gateway 経由で SSM エンドポイントに接続しに行く（VPC エンドポイントは M9 で比較）。
resource "aws_instance" "bastion" {
  ami                         = data.aws_ssm_parameter.bastion_ami.value
  instance_type               = var.bastion_instance_type
  subnet_id                   = data.terraform_remote_state.network.outputs.private_subnet_ids[0]
  vpc_security_group_ids      = [data.terraform_remote_state.network.outputs.bastion_security_group_id]
  iam_instance_profile        = aws_iam_instance_profile.bastion.name
  associate_public_ip_address = false

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_size = 8
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${var.project_name}-bastion"
  }
}
```

- [ ] **Step 2: fmt / validate / lint を通す**

Run: `just tf-fmt && just tf-validate && just tf-lint`
Expected: エラー無し。

- [ ] **Step 3: Commit**

```bash
git add infra/data/bastion.tf
git commit -m "feat(infra): data層にSSM踏み台EC2とIAMロールを追加する"
```

---

## Task 5: data層の outputs と README

**Files:**
- Create: `infra/data/outputs.tf`
- Create: `infra/data/README.md`

**Interfaces:**
- Produces: outputs `db_address` / `db_port` / `db_name` / `db_username` / `db_instance_identifier` / `db_secret_arn` / `db_secret_name` / `bastion_instance_id` / `aws_region`（Task 6 の justfile レシピと M4 の app 層が参照する）

- [ ] **Step 1: outputs.tf を作成する**

パスワードは出力しない。Secrets Manager と tfstate の中だけに置く。

```hcl
output "db_address" {
  description = "RDS のエンドポイントホスト名（ポートを含まない）。"
  value       = aws_db_instance.app.address
}

output "db_port" {
  description = "RDS のポート番号。"
  value       = aws_db_instance.app.port
}

output "db_name" {
  description = "初期作成されるデータベース名。"
  value       = aws_db_instance.app.db_name
}

output "db_username" {
  description = "マスターユーザー名（パスワードは出力しない）。"
  value       = aws_db_instance.app.username
}

output "db_instance_identifier" {
  description = "RDS インスタンスの識別子。"
  value       = aws_db_instance.app.identifier
}

output "db_secret_arn" {
  description = "DB 認証情報シークレットの ARN（値そのものは出力しない）。"
  value       = aws_secretsmanager_secret.db.arn
}

output "db_secret_name" {
  description = "DB 認証情報シークレットの名前。just db-url が参照する。"
  value       = aws_secretsmanager_secret.db.name
}

output "bastion_instance_id" {
  description = "SSM ポートフォワードの起点になる踏み台 EC2 のインスタンス ID。"
  value       = aws_instance.bastion.id
}

output "aws_region" {
  description = "全層で共通のリージョン。"
  value       = var.aws_region
}
```

- [ ] **Step 2: README.md を作成する**

```markdown
# data

セッション毎に作り直すデータ層。RDS PostgreSQL・DB 認証情報シークレット・SSM 踏み台 EC2 を持つ。**この層だけがステートフル**（RDS のデータは destroy で消える。踏み台はステートレス）。

## 依存

- `infra/bootstrap/`（tfstate バケット。`just tf-apply data` が `-backend-config` で自動的に配線する）
- `infra/network/`（`terraform_remote_state` で `private_subnet_ids` / `rds_security_group_id` / `bastion_security_group_id` を読む。**network を先に apply していないと plan がわかりにくいエラーで落ちる**）

## 出力

| 名前 | 用途 |
|---|---|
| `db_address` | RDS のエンドポイントホスト名 |
| `db_port` | RDS のポート番号 |
| `db_name` | 初期データベース名（`app`） |
| `db_username` | マスターユーザー名（`app`） |
| `db_instance_identifier` | RDS インスタンス識別子 |
| `db_secret_arn` | DB 認証情報シークレットの ARN |
| `db_secret_name` | 同シークレットの名前（`just db-url` が参照） |
| `bastion_instance_id` | SSM ポートフォワードの起点になる踏み台の ID |
| `aws_region` | 全層で共通のリージョン |

**パスワードは output しない。** Secrets Manager とこの層の tfstate の中だけに存在する。

## 接続手順（SSM ポートフォワード）

RDS は private subnet にあり、パブリックアクセスも無効なので、ローカルからは直接繋がらない。`AWS-StartPortForwardingSessionToRemoteHost` は **SSM 管理下のインスタンスを起点に** 任意の `host:port` へフォワードする仕組みで、RDS 自体は SSM 管理ノードになれない。そのため踏み台 EC2 が要る（ECS Exec は interactive command のみでポートフォワードに非対応なので、M4 を待っても解決しない）。

ターミナル1（トンネルを張る。開いたままにする）:

```console
$ just db-tunnel
```

ターミナル2（migration / seed / 接続確認）:

```console
$ just db-migrate
$ just db-seed
$ just db-check
```

`psql` を使う場合（`psql` は mise 管理外。未インストールなら `brew install libpq`）:

```console
$ just db-psql
```

## 注意

- **セッション毎レイヤー。** 使い終わったら `just tf-destroy data` で必ず壊す（`just down` は app → data → network の順に destroy する）。RDS `db.t4g.micro` は ~$0.02/h、踏み台 t4g.nano は僅少だが、消し忘れると踏み台だけで ~$3/月
- **destroy 順序。** `data` は `network` の SG/subnet を参照しているので、`network` を先に destroy してはいけない（`DependencyViolation` で失敗し、NAT Gateway と EIP が残って課金が続く）
- **RDS のデータは destroy で消える。** スキーマは Drizzle の migration（`just db-migrate`）、初期データは `just db-seed` で毎回流し直す
- **`manage_master_user_password` を使わない理由。** RDS が所有するシークレットは Terraform のリソースとして持てず recovery window を制御できないため、destroy のたびに削除待ちのシークレットが $0.40/月 ずつ残る恐れがある。`random_password` + 自前の `aws_secretsmanager_secret`（`recovery_window_in_days = 0`）なら destroy で確実に消え、状態が決定的になる。代償は「パスワードが tfstate に平文で載る」こと（tfstate バケットは SSE-S3 + public access block 済み）
- **`random_password` の記号制約。** RDS のマスターパスワードは `/` `@` `"` スペースを禁止する。`override_special` で明示的に除外している。`terraform validate` は通り `apply` で落ちるので気づきにくい
- **`rds.force_ssl = 1`。** クライアントは TLS 必須。接続文字列に `sslmode=require` を付ける（`verify-full` は RDS の CA 証明書バンドル取得が要るので採らない。経路暗号化のみ担保する落とし所）
- **踏み台の SG は `infra/network/` にある。** M2 の慣習どおり SG という「箱」は network 層。ingress は持たず、egress は 443（SSM エンドポイント）と RDS SG 宛て 5432（ポートフォワードの実体）の2本。設計ドキュメントは「egress は 443 のみ」と書いているが、Terraform が既定の全許可 egress を削除するため、5432 が無いとポートフォワードがタイムアウトする
- **AMI は SSM Parameter Store 参照。** `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64` を読むので常に最新の Amazon Linux 2023 arm64 になる。踏み台は使い捨てなので AMI が変わっても困らない
```

- [ ] **Step 3: fmt / validate を通す**

Run: `just tf-fmt && just tf-validate`
Expected: エラー無し。

- [ ] **Step 4: Commit**

```bash
git add infra/data/outputs.tf infra/data/README.md
git commit -m "docs(infra): data層のoutputsとREADMEを追加する"
```

---

## Task 6: justfile の db グループと leaks を実体化する

M0でプレースホルダとして書かれた `db-*` レシピを、実際に動くコマンドに置き換える。`leaks` に踏み台EC2の検出を足す。

**Files:**
- Modify: `justfile`（`db` グループの5レシピを置き換え、`db-tunnel` / `db-url` / `db-check` を新設、`leaks` に `describe-instances` を追加）

**Interfaces:**
- Consumes: data層 outputs `bastion_instance_id` / `db_address` / `db_secret_name`
- Produces: `just db-tunnel` / `just db-url` / `just db-migrate` / `just db-seed` / `just db-check` / `just db-psql`（Task 8 の検証が使う）

- [ ] **Step 1: db グループを置き換える**

`justfile` の `# db — Drizzle と DB 接続` セクション全体（`db-generate` から `db-psql` まで）を以下で置き換える。

**justfile の注意点:** レシピ本体のバックティックは just のコマンド置換として解釈されるため使わない（`$(...)` を使う）。`{{` も just の補間なので JS のテンプレートリテラルは避け、文字列結合で書く。

```just
# ------------------------------------------------------------------
# db — Drizzle と DB 接続
# ------------------------------------------------------------------

# Drizzle スキーマから migration SQL を生成する（AWS には繋がない）
[group('db')]
db-generate:
    pnpm --filter @repo/core exec drizzle-kit generate

# SSM ポートフォワードで RDS への localhost:5432 トンネルを張る（開いたままにする）
[group('db')]
db-tunnel:
    aws ssm start-session \
        --target "$(cd infra/data && terraform output -raw bastion_instance_id)" \
        --document-name AWS-StartPortForwardingSessionToRemoteHost \
        --parameters host="$(cd infra/data && terraform output -raw db_address)",portNumber="5432",localPortNumber="5432"

# Secrets Manager の DB 認証情報から localhost トンネル用の接続文字列を組み立てて表示する
[group('db')]
db-url:
    @aws secretsmanager get-secret-value \
        --secret-id "$(cd infra/data && terraform output -raw db_secret_name)" \
        --query SecretString --output text \
    | node -e 'let s="";process.stdin.on("data",d=>{s+=d}).on("end",()=>{const v=JSON.parse(s);process.stdout.write("postgres://"+v.username+":"+encodeURIComponent(v.password)+"@localhost:5432/"+v.dbname+"?sslmode=require\n")})'

# 生成済みの migration を RDS に適用する（db-tunnel を別ターミナルで開いておくこと）
[group('db')]
db-migrate:
    DATABASE_URL="$(just db-url)" pnpm --filter @repo/core exec drizzle-kit migrate

# 初期データを投入する（destroy → apply の後、毎回流し直す前提）
[group('db')]
db-seed:
    DATABASE_URL="$(just db-url)" pnpm --filter @repo/core exec node src/db/seed.ts

# トンネル越しに接続してテーブル一覧と items の件数を表示する（psql 不要）
[group('db')]
db-check:
    DATABASE_URL="$(just db-url)" pnpm --filter @repo/core exec node src/db/check.ts

# psql で接続する（別ターミナルで just db-tunnel を開いておくこと。psql は mise 管理外）
[group('db')]
db-psql:
    psql "$(just db-url)"
```

- [ ] **Step 2: leaks に踏み台EC2の検出を追加する**

`justfile` の `leaks` レシピに1行足す（`describe-nat-gateways` の直後）。

```just
# 消し残しリソースを検出する（down の後に必ず実行）
[group('cost')]
leaks:
    aws ec2 describe-nat-gateways --filter Name=state,Values=available
    aws ec2 describe-instances --filters Name=instance-state-name,Values=running,pending,stopping,stopped
    aws ec2 describe-addresses
    aws elbv2 describe-load-balancers
    aws rds describe-db-instances
    aws secretsmanager list-secrets --include-planned-deletion
```

- [ ] **Step 3: just --list が壊れていないことを確認する**

Run: `just --list`
Expected: `db` グループに `db-check` / `db-generate` / `db-migrate` / `db-psql` / `db-seed` / `db-tunnel` / `db-url` が doc コメント付きで並ぶ。パースエラーが出ない。

- [ ] **Step 4: Commit**

```bash
git add justfile
git commit -m "feat(just): dbグループをDrizzle+SSMトンネルの実コマンドにし、leaksにEC2検出を追加する"
```

---

## Task 7: `@repo/core` に Drizzle のスキーマ・接続・seed を実装する

AWSには繋がずにテストできる純粋関数（シークレットJSONのパース、接続文字列の組み立て）をTDDで実装し、その上にDrizzleのスキーマ・クライアント・seed/checkスクリプトを載せる。

**Files:**
- Modify: `packages/core/package.json`（`drizzle-orm` / `pg` を dependencies、`drizzle-kit` / `@types/pg` を devDependencies に追加）
- Create: `packages/core/drizzle.config.ts`
- Create: `packages/core/src/db/schema.ts`
- Create: `packages/core/src/db/connection.ts`
- Create: `packages/core/src/db/connection.test.ts`
- Create: `packages/core/src/db/client.ts`
- Create: `packages/core/src/db/seed.ts`
- Create: `packages/core/src/db/check.ts`
- Modify: `packages/core/src/index.ts`（`db/schema.ts` と `db/connection.ts` と `db/client.ts` を再エクスポート）

**Interfaces:**
- Produces:
  - `items` テーブル（Drizzle スキーマ。列は `id: uuid PK default random` / `title: text not null` / `note: text nullable` / `createdAt: timestamptz not null default now()`）
  - `type DbSecret = { host: string; port: number; dbname: string; username: string; password: string }`
  - `parseDbSecret(json: string): DbSecret`
  - `buildConnectionString(secret: DbSecret, overrides?: { host?: string; port?: number }): string`
  - `createDb(connectionString: string): { db: NodePgDatabase<typeof schema>; close: () => Promise<void> }`
  - M4 の `apps/api` がこれらを使って items を書き込む

- [ ] **Step 1: 依存を追加する**

Run:
```bash
pnpm --filter @repo/core add drizzle-orm pg
pnpm --filter @repo/core add -D drizzle-kit @types/pg
```
Expected: `packages/core/package.json` に4つが入り、`pnpm-lock.yaml` が更新される。

- [ ] **Step 2: 失敗するテストを書く**

Create `packages/core/src/db/connection.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildConnectionString, parseDbSecret } from './connection.ts';

const secretJson = JSON.stringify({
  host: 'learn-aws-saas-ts-app.abc123.ap-northeast-1.rds.amazonaws.com',
  port: 5432,
  dbname: 'app',
  username: 'app',
  password: 'p@ss word/with:symbols',
});

describe('parseDbSecret', () => {
  it('Secrets Manager の JSON を DbSecret に変換する', () => {
    const secret = parseDbSecret(secretJson);

    expect(secret.host).toBe('learn-aws-saas-ts-app.abc123.ap-northeast-1.rds.amazonaws.com');
    expect(secret.port).toBe(5432);
    expect(secret.dbname).toBe('app');
    expect(secret.username).toBe('app');
    expect(secret.password).toBe('p@ss word/with:symbols');
  });

  it('必須フィールドが欠けている場合はエラーを投げる', () => {
    const broken = JSON.stringify({ host: 'h', port: 5432, dbname: 'app', username: 'app' });

    expect(() => parseDbSecret(broken)).toThrow('db secret is missing fields: password');
  });

  it('JSON でない場合はエラーを投げる', () => {
    expect(() => parseDbSecret('not json')).toThrow('db secret is not valid JSON');
  });
});

describe('buildConnectionString', () => {
  it('記号を含むパスワードを URL エンコードして接続文字列を組み立てる', () => {
    const url = buildConnectionString(parseDbSecret(secretJson));

    expect(url).toBe(
      'postgres://app:p%40ss%20word%2Fwith%3Asymbols@learn-aws-saas-ts-app.abc123.ap-northeast-1.rds.amazonaws.com:5432/app?sslmode=require',
    );
  });

  it('SSM トンネル用に host と port を上書きできる', () => {
    const url = buildConnectionString(parseDbSecret(secretJson), {
      host: 'localhost',
      port: 5432,
    });

    expect(url).toBe(
      'postgres://app:p%40ss%20word%2Fwith%3Asymbols@localhost:5432/app?sslmode=require',
    );
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `pnpm --filter @repo/core exec vitest run src/db/connection.test.ts`
Expected: FAIL（`Failed to resolve import "./connection.ts"`）

- [ ] **Step 4: 最小の実装を書く**

Create `packages/core/src/db/connection.ts`:

```typescript
/** Secrets Manager の `<project>/db` に入っている JSON の形。 */
export interface DbSecret {
  host: string;
  port: number;
  dbname: string;
  username: string;
  password: string;
}

const REQUIRED_FIELDS = ['host', 'port', 'dbname', 'username', 'password'] as const;

/** Secrets Manager から取得した SecretString を DbSecret に変換する。 */
export function parseDbSecret(json: string): DbSecret {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('db secret is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('db secret is not valid JSON');
  }

  const record = parsed as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`db secret is missing fields: ${missing.join(', ')}`);
  }

  return {
    host: String(record.host),
    port: Number(record.port),
    dbname: String(record.dbname),
    username: String(record.username),
    password: String(record.password),
  };
}

/**
 * postgres 接続文字列を組み立てる。
 * RDS の parameter group で rds.force_ssl = 1 にしているので sslmode=require を必ず付ける。
 * SSM ポートフォワード経由で繋ぐときは host/port を localhost に上書きする。
 */
export function buildConnectionString(
  secret: DbSecret,
  overrides: { host?: string; port?: number } = {},
): string {
  const host = overrides.host ?? secret.host;
  const port = overrides.port ?? secret.port;
  const user = encodeURIComponent(secret.username);
  const password = encodeURIComponent(secret.password);

  return `postgres://${user}:${password}@${host}:${port}/${secret.dbname}?sslmode=require`;
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `pnpm --filter @repo/core exec vitest run src/db/connection.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 6: Drizzle スキーマを書く**

Create `packages/core/src/db/schema.ts`:

```typescript
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * items の本体（RDB 側）。
 * 処理ステータスは DynamoDB 側が持つ（@repo/contracts の Item はこの2つを合成した形）。
 */
export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
```

- [ ] **Step 7: Drizzle のクライアントを書く**

Create `packages/core/src/db/client.ts`:

```typescript
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export interface Db {
  db: NodePgDatabase<typeof schema>;
  close: () => Promise<void>;
}

/**
 * 接続文字列から Drizzle クライアントを作る。
 * rds.force_ssl = 1 なので TLS は必須。RDS の CA バンドルは取得しない方針のため
 * rejectUnauthorized: false（経路暗号化のみ担保する = sslmode=require 相当）。
 */
export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}
```

- [ ] **Step 8: drizzle.config.ts を書く**

Create `packages/core/drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
    ssl: { rejectUnauthorized: false },
  },
});
```

- [ ] **Step 9: seed と check スクリプトを書く**

Create `packages/core/src/db/seed.ts`:

```typescript
import { createDb } from './client.ts';
import { items } from './schema.ts';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === '') {
  throw new Error('DATABASE_URL is not set (just db-seed が組み立てて渡す)');
}

const { db, close } = createDb(connectionString);

// destroy → apply のたびに流し直す前提なので、毎回入れ直す。
await db.delete(items);
await db.insert(items).values([
  { title: 'first seeded item', note: 'M3 の seed で投入' },
  { title: 'second seeded item', note: null },
]);

const rows = await db.select().from(items);
console.log(`seeded ${rows.length} items`);

await close();
```

Create `packages/core/src/db/check.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { createDb } from './client.ts';
import { items } from './schema.ts';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === '') {
  throw new Error('DATABASE_URL is not set (just db-check が組み立てて渡す)');
}

const { db, close } = createDb(connectionString);

const tables = await db.execute(
  sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
);
console.log('tables:', tables.rows.map((row) => row.table_name).join(', '));

const rows = await db.select().from(items);
console.log(`items rows: ${rows.length}`);
for (const row of rows) {
  console.log(`  ${row.id} ${row.title}`);
}

await close();
```

- [ ] **Step 10: index.ts から再エクスポートする**

`packages/core/src/index.ts` を以下に置き換える（`seed.ts` / `check.ts` は import しただけで実行される実行スクリプトなので、**再エクスポートしない**）。

```typescript
export * from './db/client.ts';
export * from './db/connection.ts';
export * from './db/schema.ts';
export * from './dynamodb.ts';
export * from './health.ts';
export * from './s3.ts';
export * from './secrets.ts';
export * from './sqs.ts';
```

- [ ] **Step 11: テスト・型チェック・lint をすべて通す**

Run: `just test && just typecheck && pnpm exec turbo run lint`
Expected: すべて PASS。`@repo/core` のテストが既存分（dynamodb / health / s3 / secrets / sqs）＋ connection の5テストで green。Biome が `drizzle.config.ts` や `src/db/*.ts` にフォーマット差分を出した場合は `pnpm exec biome check --write .` で直してから再実行する。

- [ ] **Step 12: migration SQL を生成する**

Run: `just db-generate`
Expected: `packages/core/drizzle/0000_*.sql` と `packages/core/drizzle/meta/` が生成され、SQL に `CREATE TABLE "items"` が含まれる（AWS には繋がない。スキーマからの生成のみ）。

Run: `cat packages/core/drizzle/*.sql`
Expected: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`、`title text NOT NULL`、`note text`、`created_at timestamp with time zone DEFAULT now() NOT NULL` 相当のDDLが出る。

- [ ] **Step 13: Commit**

```bash
git add packages/core package.json pnpm-lock.yaml
git commit -m "feat(core): Drizzleのitemsスキーマ・接続文字列組み立て・seed/checkを追加する"
```

---

## Task 8: apply して SSM 経由で migration・seed・接続確認まで通す（ユーザー承認必須）

**このタスクは実AWSリソースを作成し、課金が発生する。各 apply の前にユーザーの明示的な承認を得ること。**

**Files:** なし（検証のみ。判明した挙動は `infra/data/README.md` に追記する）

- [ ] **Step 1: network 層が apply 済みかを確認する**

Run: `cd infra/network && mise exec -- terraform output`
Expected: outputs が表示される。**エラーになる（= network が destroy 済み）場合は、先に `echo yes | just tf-apply network` の承認をユーザーから得て apply する。** data 層は network の `terraform_remote_state` を読むので、network が無いと plan が落ちる。

network が apply 済みでも Task 1 の bastion SG がまだ反映されていないので、必ず再 apply する:

Run: `echo yes | just tf-apply network`
Expected: `Apply complete!`（bastion SG + egress2本 + rds ingress1本 = 4リソース追加）

- [ ] **Step 2: data 層の plan を確認する**

Run: `just tf-plan data`
Expected: `Plan: 8 to add, 0 to change, 0 to destroy.` 付近（subnet group1 + parameter group1 + RDS1 + random_password1 + secret1 + secret_version1 + IAM role1 + role policy attachment1 + instance profile1 + EC2 1 = 10前後）。実際の数を確認し、想定外のdiffが無いこと・パスワードが `(sensitive value)` として扱われていることを確認する。

- [ ] **Step 3: ユーザーに plan を提示し、apply の承認を得る**

作成されるリソース一覧と想定コスト（RDS `db.t4g.micro` ~$0.02/h + gp3 20GiB + t4g.nano、4時間セッションで ~$0.1 程度の追加）を提示し、明示的な「はい」を得るまで次に進まない。

- [ ] **Step 4: apply を実行する**

Run: `echo yes | just tf-apply data`
Expected: `Apply complete!`。RDS の作成に5〜10分かかる（タイムアウトに注意。`timeout` を長めに設定して実行する）。

- [ ] **Step 5: outputs を確認する**

Run: `cd infra/data && mise exec -- terraform output`
Expected: Task 5 の9つの output が値を持つ。パスワードがどの output にも含まれていない。

- [ ] **Step 6: SSM トンネルを張る**

`just db-tunnel` は前面で動き続けるプロセスなので、バックグラウンド実行する。

Run: `just db-tunnel`（バックグラウンド実行）
Expected: `Waiting for connections...` / `Connection accepted for session` のような出力が出る。

**繋がらない場合の切り分け:**
1. 踏み台が SSM 管理下に入るまで起動後1〜2分かかる。`aws ssm describe-instance-information --query "InstanceInformationList[].InstanceId"` に bastion の instance ID が出るまで待つ
2. 出てこない場合は SSM Agent が NAT 経由でエンドポイントに到達できていない。network 層の private route table の `0.0.0.0/0` → NAT ルートと、bastion SG の 443 egress を確認する
3. トンネルは張れるが RDS に繋がらない場合は bastion SG の 5432 egress と rds SG の bastion からの ingress を確認する

- [ ] **Step 7: 接続文字列が組み立てられることを確認する**

Run: `just db-url`
Expected: `postgres://app:...@localhost:5432/app?sslmode=require` の形の1行が出る。

- [ ] **Step 8: migration を適用する**

Run: `just db-migrate`
Expected: drizzle-kit が migration を適用して完了する（`No config path provided` 等の警告は出てよいが、エラー無しで終わること）。

- [ ] **Step 9: seed を流す**

Run: `just db-seed`
Expected: `seeded 2 items`

- [ ] **Step 10: テーブルが見えることを確認する（M3の検証条件）**

Run: `just db-check`
Expected:
```
tables: __drizzle_migrations, items
items rows: 2
  <uuid> first seeded item
  <uuid> second seeded item
```
（`__drizzle_migrations` は drizzle のバージョンによって `drizzle` スキーマ側に作られ `public` に出ないことがある。`items` が見えて2行あれば検証条件は満たす。）

- [ ] **Step 11: 冪等性を確認する**

Run: `just db-seed && just db-check`
Expected: 再度 `seeded 2 items` と `items rows: 2`（seed が毎回 delete → insert するので件数が増えない）。

- [ ] **Step 12: 実機で判明した挙動を README に追記する**

Step 6〜11 で想定と違った点（SSM 管理下に入るまでの待ち時間、drizzle-kit の警告、`__drizzle_migrations` の置き場所など）を `infra/data/README.md` の「接続手順」または「注意」に追記する。何も無ければ追記しない。

- [ ] **Step 13: Commit**

```bash
git add infra/data/README.md
git commit -m "docs(infra): M3の実機検証で判明した挙動をdata層READMEに反映する"
```
（追記が無ければコミットしない。）

---

## Task 9: destroy して消し残しゼロを確認する（ユーザー承認必須）

**このタスクは実AWSリソースを破壊する。実行前にユーザーの明示的な承認を得ること。**

**Files:** なし

- [ ] **Step 1: ユーザーに destroy 対象と順序を提示し、承認を得る**

`data` → `network` の順に destroy する（逆順にすると `DependencyViolation` で network が壊れずに残り、NAT Gateway と EIP の課金が続く）。RDS のデータが消えることも明示する。明示的な「はい」を得るまで進まない。

- [ ] **Step 2: トンネルを終了する**

Step 6 でバックグラウンド起動した `just db-tunnel` のプロセスを終了する。

- [ ] **Step 3: data 層を destroy する**

`tf-destroy` には `[confirm(...)]` が付いている。`just --yes` で just 側の確認をスキップし、標準入力は terraform destroy の確認プロンプト用に1行だけ渡す（M2で実証済みの形）。

Run: `echo yes | just --yes tf-destroy data`
Expected: `Destroy complete!`（RDS の削除に数分かかる）

- [ ] **Step 4: network 層を destroy する**

Run: `echo yes | just --yes tf-destroy network`
Expected: `Destroy complete!`（`DependencyViolation` が出ないこと。出た場合は data 層に消し残りがある）

- [ ] **Step 5: leaks を確認する**

Run: `just leaks`
Expected: NAT Gateway / EC2 インスタンス / EIP / ALB / RDS インスタンスがいずれもゼロ件。`list-secrets --include-planned-deletion` に `learn-aws-saas-ts/db` が**残っていない**こと（`recovery_window_in_days = 0` が効いている証拠。`learn-aws-saas-ts/app` は platform 層の常時起動シークレットなので残っていて正しい）。

- [ ] **Step 6: 結果をユーザーに報告する**

destroy 完了と leaks ゼロ件を報告し、この状態（課金対象リソース無し）で終えてよいかを確認する。

- [ ] **Step 7: Commit**

このタスクではコミットするファイルが無ければ何もしない。

---

## 完了条件

- `just tf-validate` / `just tf-lint` / `just test` / `just typecheck` がすべて green
- `infra/data/` が RDS・DB認証情報シークレット・SSM踏み台を持ち、`infra/network/` が bastion SG を持つ
- SSM ポートフォワード経由で `just db-migrate` → `just db-seed` → `just db-check` が通り、`items` テーブルと2行が見える（**spec の M3 検証条件**）
- `just tf-destroy data` → `just tf-destroy network` → `just leaks` がゼロ件、DB シークレットが削除待ちにも残らない
- `docs/superpowers/specs/2026-08-15-aws-saas-backend-design.md` のマイルストーン節で M3 に完了マークを付ける（最終コミット）

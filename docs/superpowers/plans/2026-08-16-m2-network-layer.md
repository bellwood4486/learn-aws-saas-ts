# M2: network層 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `infra/network/` に VPC・public/private subnet（2AZ）・IGW・NAT Gateway・route table・ALB/ECS/RDS用SGをTerraformで実装してapplyし、`just tf-destroy <layer>`コマンドを新設した上でdestroy・`just leaks`ゼロ件までを確認する。

**Architecture:** `infra/bootstrap/`が作ったtfstateバケットをS3 backendとして使う新しいTerraform層（`infra/network/`）を、`infra/platform/`と同じくリソース種別ごとにファイル分割して追加する。SGはALB/ECS/RDS用の「箱」とingressルールだけをこの層にまとめ、実際のALB/ECS/RDSリソースはM3/M4で作る。session毎に作り直す層なので、justfileに`tf-destroy`レシピを新設する。

**Tech Stack:** Terraform 1.15.8 / AWS provider `~> 6.0` / TFLint（`tflint-ruleset-aws`）

**Spec:** `docs/superpowers/specs/2026-08-15-aws-saas-backend-design.md`（「M2: network層」節、「Terraform のレイヤー分割」節、「検証方法」節のM2行）

## Global Constraints

- Terraformリソース名はsnake_case・単数形、リソースタイプ名を名前に繰り返さない。用途がわかる名前を付ける（`this`/`main`は使わない）
- アカウントIDを使うリソースがこの層には無いため、`data.tf`（`data.aws_caller_identity.current`）は追加しない
- providerの`default_tags`で`Project`/`ManagedBy`/`Layer`を全リソースに付与する（`Layer = "network"`）
- backendはS3のみ、DynamoDBロックテーブルは使わない（`use_lockfile = true`）
- SGルールは`aws_security_group`の`ingress`/`egress`ブロックに埋め込まず、`aws_vpc_security_group_ingress_rule`として1リソース＝1ルールで書く（attachment resourceパターン）
- 明示的なegressルールは作らない。新規SGにAWSが自動付与する「全許可」のデフォルトegressルールをそのまま使う（Terraformで同内容のegressルールを明示すると`InvalidPermission.Duplicate`で失敗するため）
- TFLintは`infra/.tflint.hcl`を絶対パスで`--config`指定して実行する（`just tf-lint`を使えば配線済み）
- VPCは`10.0.0.0/16`、AZは`ap-northeast-1a`/`1c`の2つ、public/private各2つを`/20`で4分割する（`10.0.0.0/20`, `10.0.16.0/20`, `10.0.32.0/20`, `10.0.48.0/20`）
- NAT Gatewayは1個のみ（public subnet 1aに配置）。private subnet 1a/1cは共通の1つのprivate route tableでNAT Gatewayを共有する（マルチAZ冗長化はしない）
- SGはALB用/ECS用/RDS用の3つをこの層で作り、`alb`（80/443 from `0.0.0.0/0`）→ `ecs`（`var.app_port`=3000 from `alb`）→ `rds`（5432 from `ecs`）のチェーンでSG ID同士を参照する
- `just up`/`just down`への組み込みはまだ行わない（`infra/data`/`app`/`edge`が未実装のため）。単層コマンド`just tf-apply network`/`just tf-destroy network`で検証する
- 実AWSへの`apply`/`destroy`はいずれも課金・破壊的操作なので、実行前に必ずユーザーの明示的な承認を得る

---

## Task 1: network層の骨格 + `tf-destroy`コマンド新設

`infra/bootstrap/`が作ったtfstateバケットをS3 backendとして使うための骨格ファイルと、session毎に作り直すこの層のために必要な`just tf-destroy <layer>`レシピを追加する。

**Files:**
- Create: `infra/network/versions.tf`
- Create: `infra/network/providers.tf`
- Create: `infra/network/variables.tf`
- Modify: `justfile:52-55`（`tf-apply`の直後に`tf-destroy`を追加）

**Interfaces:**
- Produces: `var.aws_region`, `var.project_name`, `var.app_port`（後続タスクの全リソースが参照する）

- [ ] **Step 1: versions.tf を作成する**

`infra/platform/versions.tf`と同一内容。

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

`infra/platform/providers.tf`と同じ構成で、`key`と`Layer`タグをnetwork用に変える。

```hcl
terraform {
  backend "s3" {
    key          = "network/terraform.tfstate"
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
      Layer     = "network"
    }
  }
}
```

- [ ] **Step 3: variables.tf を作成する**

`aws_region`/`project_name`は`infra/platform/variables.tf`と同一。`app_port`はECSタスク（api、M4で追加）がリッスンするポートで、`apps/api/src/main.ts`のデフォルト値（`process.env.PORT ?? 3000`）に合わせる。

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

variable "app_port" {
  description = "ECS タスクで動く api コンテナがリッスンするポート。ALB からの ingress を許可するために使う。"
  type        = number
  default     = 3000
}
```

- [ ] **Step 4: justfile に tf-destroy レシピを追加する**

`justfile:52`の`tf-apply`レシピの直後（`justfile:55`と`justfile:57`の間）に追加する。`tf-plan`/`tf-apply`と同じ`-backend-config`配線パターンに揃える。

現在の該当箇所:
```just
# 指定した層で terraform apply を実行する
[group('tf')]
tf-apply layer:
    cd infra/{{layer}} && terraform init -input=false -backend-config="bucket=$(cd ../bootstrap && terraform output -raw tfstate_bucket)" && terraform apply

# 全層に terraform fmt をかける
```

変更後:
```just
# 指定した層で terraform apply を実行する
[group('tf')]
tf-apply layer:
    cd infra/{{layer}} && terraform init -input=false -backend-config="bucket=$(cd ../bootstrap && terraform output -raw tfstate_bucket)" && terraform apply

# 指定した層で terraform destroy を実行する（セッション毎レイヤー用）
[group('tf')]
tf-destroy layer:
    cd infra/{{layer}} && terraform init -input=false -backend-config="bucket=$(cd ../bootstrap && terraform output -raw tfstate_bucket)" && terraform destroy

# 全層に terraform fmt をかける
```

- [ ] **Step 5: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/network && mise exec -- terraform init -input=false -backend=false && mise exec -- terraform validate
just --list | grep tf-destroy
```
Expected: `terraform validate`が`Success! The configuration is valid.`（この時点ではリソースが無いので警告なく通る）。`just --list`に`tf-destroy`が表示される。

- [ ] **Step 6: Commit**

```bash
git add infra/network/versions.tf infra/network/providers.tf infra/network/variables.tf justfile
git commit -m "feat(infra): network層の骨格とtf-destroyコマンドを追加"
```

---

## Task 2: VPC + Internet Gateway

**Files:**
- Create: `infra/network/vpc.tf`

**Interfaces:**
- Consumes: `var.project_name`（Task 1）
- Produces: `aws_vpc.app`, `aws_internet_gateway.app`（Task 3〜5が参照する）

- [ ] **Step 1: vpc.tf を作成する**

DNSホスト名解決はRDSエンドポイントやECS Service Connectなど後続の層で必要になるため、ここで有効化しておく。

```hcl
resource "aws_vpc" "app" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.project_name}-app"
  }
}

resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-app"
  }
}
```

- [ ] **Step 2: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/network && mise exec -- terraform validate
just tf-lint
```
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add infra/network/vpc.tf
git commit -m "feat(infra): network層にVPCとInternet Gatewayを追加"
```

---

## Task 3: Subnet（public/private × 2AZ）

**Files:**
- Create: `infra/network/subnets.tf`

**Interfaces:**
- Consumes: `aws_vpc.app`（Task 2）, `var.aws_region`（Task 1）
- Produces: `aws_subnet.public_1a`, `aws_subnet.public_1c`, `aws_subnet.private_1a`, `aws_subnet.private_1c`（Task 4〜6が参照する）

- [ ] **Step 1: subnets.tf を作成する**

```hcl
resource "aws_subnet" "public_1a" {
  vpc_id                  = aws_vpc.app.id
  cidr_block               = "10.0.0.0/20"
  availability_zone        = "${var.aws_region}a"
  map_public_ip_on_launch  = true

  tags = {
    Name = "${var.project_name}-public-1a"
  }
}

resource "aws_subnet" "public_1c" {
  vpc_id                  = aws_vpc.app.id
  cidr_block               = "10.0.16.0/20"
  availability_zone        = "${var.aws_region}c"
  map_public_ip_on_launch  = true

  tags = {
    Name = "${var.project_name}-public-1c"
  }
}

resource "aws_subnet" "private_1a" {
  vpc_id            = aws_vpc.app.id
  cidr_block        = "10.0.32.0/20"
  availability_zone = "${var.aws_region}a"

  tags = {
    Name = "${var.project_name}-private-1a"
  }
}

resource "aws_subnet" "private_1c" {
  vpc_id            = aws_vpc.app.id
  cidr_block        = "10.0.48.0/20"
  availability_zone = "${var.aws_region}c"

  tags = {
    Name = "${var.project_name}-private-1c"
  }
}
```

- [ ] **Step 2: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/network && mise exec -- terraform validate
just tf-lint
```
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add infra/network/subnets.tf
git commit -m "feat(infra): network層にpublic/private subnetを追加"
```

---

## Task 4: NAT Gateway + Route Table

**Files:**
- Create: `infra/network/routing.tf`

**Interfaces:**
- Consumes: `aws_vpc.app`, `aws_internet_gateway.app`（Task 2）, `aws_subnet.*`（Task 3）
- Produces: `aws_nat_gateway.app`, `aws_route_table.public`, `aws_route_table.private`（Task 6が参照する）

- [ ] **Step 1: routing.tf を作成する**

NAT Gatewayは1個のみ、public subnet 1aに配置してprivate subnet 1a/1c両方から共有する。`aws_nat_gateway`はIGWがアタッチされた後でないと作成に失敗することがあるため、明示的に`depends_on`を付ける。

```hcl
resource "aws_eip" "nat" {
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-nat"
  }
}

resource "aws_nat_gateway" "app" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_1a.id

  tags = {
    Name = "${var.project_name}-app"
  }

  depends_on = [aws_internet_gateway.app]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-public"
  }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id              = aws_internet_gateway.app.id
}

resource "aws_route_table_association" "public_1a" {
  subnet_id      = aws_subnet.public_1a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_1c" {
  subnet_id      = aws_subnet.public_1c.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-private"
  }
}

resource "aws_route" "private_nat" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id          = aws_nat_gateway.app.id
}

resource "aws_route_table_association" "private_1a" {
  subnet_id      = aws_subnet.private_1a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_1c" {
  subnet_id      = aws_subnet.private_1c.id
  route_table_id = aws_route_table.private.id
}
```

- [ ] **Step 2: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/network && mise exec -- terraform validate
just tf-lint
```
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add infra/network/routing.tf
git commit -m "feat(infra): network層にNAT Gatewayとroute tableを追加"
```

---

## Task 5: Security Group（ALB / ECS / RDS）

ALB→ECS→RDSの通信経路だけを許可するSGのチェーンを作る。ALB/ECS/RDS自体のリソースはこの層には無い（M3/M4で作る）が、SGの「箱」とingressルールはVPCの一部としてここに置く。

**Files:**
- Create: `infra/network/security_groups.tf`

**Interfaces:**
- Consumes: `aws_vpc.app`（Task 2）, `var.app_port`（Task 1）
- Produces: `aws_security_group.alb`, `aws_security_group.ecs`, `aws_security_group.rds`（Task 6が参照し、M3/M4のdata/app層がremote stateで参照する）

- [ ] **Step 1: security_groups.tf を作成する**

egressルールは明示せず、AWSが新規SGに自動付与する「全許可」のデフォルトルールをそのまま使う（Global Constraints参照）。

```hcl
resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "ALB 用。インターネットから HTTP/HTTPS を受け付ける。"
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-alb"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4          = "0.0.0.0/0"
  from_port           = 80
  to_port             = 80
  ip_protocol         = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4          = "0.0.0.0/0"
  from_port           = 443
  to_port             = 443
  ip_protocol         = "tcp"
}

resource "aws_security_group" "ecs" {
  name        = "${var.project_name}-ecs"
  description = "ECS タスク用。ALB からのみアプリポートを受け付ける。"
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-ecs"
  }
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                     = var.app_port
  to_port                        = var.app_port
  ip_protocol                    = "tcp"
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds"
  description = "RDS 用。ECS タスクからのみ PostgreSQL ポートを受け付ける。"
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-rds"
  }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_ecs" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                     = 5432
  to_port                        = 5432
  ip_protocol                    = "tcp"
}
```

- [ ] **Step 2: fmt と構文チェックを実行する**

Run:
```bash
just tf-fmt
cd infra/network && mise exec -- terraform validate
just tf-lint
```
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add infra/network/security_groups.tf
git commit -m "feat(infra): network層にALB/ECS/RDS用SGを追加"
```

---

## Task 6: outputs.tf / README.md / TFLint最終確認

**Files:**
- Create: `infra/network/outputs.tf`
- Create: `infra/network/README.md`

**Interfaces:**
- Consumes: Task 2〜5の全リソース

- [ ] **Step 1: outputs.tf を作成する**

```hcl
output "vpc_id" {
  description = "network 層で作成した VPC の ID。"
  value       = aws_vpc.app.id
}

output "public_subnet_ids" {
  description = "public subnet（ALB配置用）の ID 一覧。"
  value       = [aws_subnet.public_1a.id, aws_subnet.public_1c.id]
}

output "private_subnet_ids" {
  description = "private subnet（ECSタスク・RDS配置用）の ID 一覧。"
  value       = [aws_subnet.private_1a.id, aws_subnet.private_1c.id]
}

output "alb_security_group_id" {
  description = "ALB に付与する SG の ID。"
  value       = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  description = "ECS タスクに付与する SG の ID。"
  value       = aws_security_group.ecs.id
}

output "rds_security_group_id" {
  description = "RDS に付与する SG の ID。"
  value       = aws_security_group.rds.id
}

output "nat_gateway_id" {
  description = "NAT Gateway の ID（参考情報）。"
  value       = aws_nat_gateway.app.id
}

output "aws_region" {
  description = "全層で共通のリージョン。"
  value       = var.aws_region
}
```

- [ ] **Step 2: README.md を作成する**

`infra/platform/README.md`の構成（概要 / 依存 / 出力表 / 注意）に倣う。

```markdown
# network

セッション毎に作り直すネットワーク層。VPC・public/private subnet（2AZ）・IGW・NAT Gateway・route table・ALB/ECS/RDS用SGを持つ。

## 依存

- `infra/bootstrap/`（tfstate バケット。`just tf-plan network` / `just tf-apply network` / `just tf-destroy network` が `-backend-config` で自動的に配線する）

## 出力

| 名前 | 用途 |
|---|---|
| `vpc_id` | この層が作る VPC の ID |
| `public_subnet_ids` | ALB 配置用 public subnet の ID 一覧 |
| `private_subnet_ids` | ECS タスク・RDS 配置用 private subnet の ID 一覧 |
| `alb_security_group_id` | M4 で ALB に付与する SG の ID |
| `ecs_security_group_id` | M4 で ECS タスクに付与する SG の ID |
| `rds_security_group_id` | M3 で RDS に付与する SG の ID |
| `nat_gateway_id` | NAT Gateway の ID（参考情報） |
| `aws_region` | 全層で共通のリージョン |

## 注意

- **セッション毎レイヤー。** 使い終わったら `just tf-destroy network` で必ず壊す。消し残すと NAT Gateway（~$0.062/h）と EIP（~$0.005/h）が課金され続ける。`just tf-destroy network` の後は必ず `just leaks` で NAT Gateway / EIP がゼロ件であることを確認する
- **ALB/ECS/RDS 自体のリソースはこの層には無い。** SG という「箱」と ingress ルールだけを VPC の一部として先に用意している。実際の ALB は M4、RDS は M3、ECS タスクは M4 で作り、それぞれこの層の SG ID を `terraform_remote_state` 経由で参照してアタッチする
- **NAT Gateway は 1 個のみ。** private subnet 1a/1c は共通の 1 つの private route table で NAT Gateway を共有する（マルチ AZ 冗長化はしない。コスト優先の学習環境のため）
- **`just up`/`just down` にはまだ組み込まれていない。** `infra/data`/`app`/`edge` が未実装のため。M3 で `data` の行、M4 で `app` の行、M7 で `edge` の行を段階的に追加する
- **「なぜ private subnet に NAT が要るのか」を確かめる演習（任意・手動）:** `aws_route.private_nat` を一時的に `terraform destroy -target=aws_route.private_nat` で消し、private subnet 内のリソースからの outbound（例: NAT 経由の ECR pull）が失敗することを確認する。確認後は `just tf-apply network` で `aws_route.private_nat` を作り直す
```

- [ ] **Step 3: 全体の fmt / tflint / validate を実行する**

Run:
```bash
just tf-fmt
just tf-lint
cd infra/network && mise exec -- terraform validate
```
Expected: tflint・validateともにエラーなし。

- [ ] **Step 4: Commit**

```bash
git add infra/network/outputs.tf infra/network/README.md
git commit -m "docs(infra): network層のoutputsとREADMEを追加"
```

---

## Task 7: terraform apply（実AWSリソース作成・ユーザー承認必須）

**このタスクは課金対象の実AWSリソースを作成する。planの内容をユーザーに提示し、明示的な承認を得てからapplyすること。**

**Files:** なし（Task 1〜6で作成した`infra/network/`を対象に実行するのみ）

- [ ] **Step 1: SSO認証を確認する**

Run: `mise exec -- aws sts get-caller-identity`
Expected: アカウント情報がJSONで返る（失効していたら`aws sso login --profile personal`をユーザーに依頼する）

- [ ] **Step 2: planを実行して内容を確認する**

Run: `just tf-plan network`
Expected: `Plan: 23 to add, 0 to change, 0 to destroy.`（VPC1 + IGW1 + subnet4 + EIP1 + NAT Gateway1 + route table2 + route2 + route table association4 + SG3 + SG ingress rule4 = 23リソース）付近の値になる。実際の数を確認し、想定外のdiffが無いことを確認する。

- [ ] **Step 3: ユーザーにplan内容を提示し、applyの承認を得る**

planの要約（作成されるリソース一覧、想定コスト ~$0.6/セッション4時間）をユーザーに提示し、明示的な「はい」を得るまで次のステップに進まない。

- [ ] **Step 4: applyを実行する**

Run: `echo yes | just tf-apply network`
Expected: `Apply complete! Resources: 23 added, 0 changed, 0 destroyed.`

- [ ] **Step 5: outputsを確認する**

Run: `cd infra/network && mise exec -- terraform output`
Expected: Task 6で定義した8つのoutputがすべて値を持って表示される（`public_subnet_ids`/`private_subnet_ids`はそれぞれ2要素のリスト）。

- [ ] **Step 6: Commit**

apply後に生成されるファイルはない（stateはS3 backendにあり、ローカルにtfstateファイルは残らない）。このタスクではコミットするファイルが無ければ何もしない。

---

## Task 8: terraform destroy検証 + leaksゼロ件確認（ユーザー承認必須）

network層はセッション毎に作り直す層であることを実際のdestroyサイクルで確認する。**このタスクは実AWSリソースを破壊する。実行前にユーザーの明示的な承認を得ること。**

**Files:** なし

- [ ] **Step 1: ユーザーにdestroy対象を提示し、承認を得る**

Task 7で作成した23リソースをdestroyする旨を提示し、明示的な「はい」を得るまで次のステップに進まない。

- [ ] **Step 2: destroyを実行する**

Run: `echo yes | just tf-destroy network`
Expected: `Destroy complete! Resources: 23 destroyed.`

- [ ] **Step 3: leaksを確認する**

Run: `just leaks`
Expected: `describe-nat-gateways`と`describe-addresses`の出力に、このセッションで作ったNAT Gateway・EIPが含まれていない（他層由来の消し残しが無ければ両方とも空の配列 `[]` に近い出力になる）。

- [ ] **Step 4: 再apply可能であることを確認する**

session毎に作り直せることを確認するため、もう一度applyしてoutputsが問題なく出ることを確認する。

Run: `echo yes | just tf-apply network && cd infra/network && mise exec -- terraform output`
Expected: `Apply complete! Resources: 23 added, 0 changed, 0 destroyed.`のあと、outputsが再び表示される。

- [ ] **Step 5: 最終状態をユーザーに確認する**

再apply後の状態（課金対象リソースが存在する状態）で終えてよいか、それとも再度destroyして終えるかをユーザーに確認する。ユーザーの指示に従う。

- [ ] **Step 6: Commit**

このタスクではコミットするファイルが無ければ何もしない。

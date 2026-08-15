# すべてのレシピを mise 経由で実行する。
# justfile は非対話シェルで走るため、nvm 等シェル関数ベースの PATH には乗らない。
# `mise exec --` を shell に噛ませることで、mise.toml が固定した node/pnpm/terraform 等を
# プロジェクトディレクトリから確実に解決する（M0 のゲート①で検証済み）。
set shell := ["mise", "exec", "--", "sh", "-c"]

infra_layers := "platform edge network data app"

# ------------------------------------------------------------------
# session — 層をまたぐ apply / destroy のオーケストレーション
# ------------------------------------------------------------------

# ネットワーク → data → app → edge の順で常時起動していない層を apply する
[group('session')]
up:
    cd infra/network && terraform apply
    cd infra/data && terraform apply
    cd infra/app && terraform apply
    cd infra/edge && terraform apply -var="alb_dns_name=$(cd infra/app && terraform output -raw alb_dns_name)"

# app を destroy する前に edge を alb_dns_name 空で再 apply し、502 の残骸を防いでから
# app → data → network の逆順で destroy する
[group('session')]
[confirm('本当に app/data/network を destroy しますか？ (RDS のデータは失われます)')]
down:
    cd infra/edge && terraform apply -var="alb_dns_name="
    cd infra/app && terraform destroy
    cd infra/data && terraform destroy
    cd infra/network && terraform destroy

# 各層の apply 状況をざっと確認する
[group('session')]
status:
    for d in bootstrap platform edge network data app; do \
        echo "=== $d ===" && (cd infra/$d && terraform show -json 2>/dev/null | grep -c '"type"' || echo "not initialized"); \
    done

# ------------------------------------------------------------------
# tf — 層を引数に取る Terraform 操作
# ------------------------------------------------------------------

# 指定した層で terraform plan を実行する（例: just tf-plan platform）
[group('tf')]
tf-plan layer:
    cd infra/{{layer}} && terraform init -input=false && terraform plan

# 指定した層で terraform apply を実行する
[group('tf')]
tf-apply layer:
    cd infra/{{layer}} && terraform apply

# 全層に terraform fmt をかける
[group('tf')]
tf-fmt:
    terraform fmt -recursive infra

# 全層で terraform fmt -check と validate をチェックする（CI 用）
[group('tf')]
tf-validate:
    terraform fmt -check -recursive infra
    for d in bootstrap platform edge network data app; do \
        (cd infra/$d && terraform init -input=false -backend=false && terraform validate) || exit 1; \
    done

# infra 全体に TFLint をかける
[group('tf')]
tf-lint:
    cd infra && tflint --recursive

# ------------------------------------------------------------------
# dev — ローカル開発サーバ
# ------------------------------------------------------------------

# Fastify api をローカルで起動する（node --watch、型除去でそのまま実行）
[group('dev')]
dev-api:
    pnpm --filter @repo/api dev

# SQS ワーカーをローカルで起動する
[group('dev')]
dev-worker:
    pnpm --filter @repo/worker dev

# Vite dev server を起動する
[group('dev')]
dev-web:
    pnpm --filter @repo/web dev

# api（ローカル）と web を同時に起動する。CloudFront も ALB も要らない
[group('dev')]
dev-all:
    pnpm --filter @repo/api --filter @repo/web --parallel dev

# ------------------------------------------------------------------
# check — turbo 経由の品質チェック
# ------------------------------------------------------------------

# 全パッケージの型チェック（tsc --noEmit）を turbo でまとめて実行する
[group('check')]
typecheck:
    pnpm exec turbo run typecheck

# Biome + tf-lint + hadolint + actionlint をまとめて実行する
[group('check')]
lint:
    pnpm exec turbo run lint
    just tf-lint
    hadolint Dockerfile
    actionlint

# 全パッケージの Vitest を turbo でまとめて実行する
[group('check')]
test:
    pnpm exec turbo run test

# Vitest を watch モードで実行する（対象パッケージは pnpm --filter で絞る）
[group('check')]
test-watch:
    pnpm exec turbo run test:watch

# ------------------------------------------------------------------
# db — Drizzle と DB 接続
# ------------------------------------------------------------------

# Drizzle スキーマから migration SQL を生成する（infra/data/ が M3 で追加後に使う）
[group('db')]
db-generate:
    pnpm --filter @repo/core exec drizzle-kit generate

# 生成済みの migration を RDS に適用する
[group('db')]
db-migrate:
    pnpm --filter @repo/core exec drizzle-kit migrate

# 初期データを投入する（destroy → apply の後、毎回流し直す前提）
[group('db')]
db-seed:
    pnpm --filter @repo/core exec node scripts/seed.ts

# SSM ポートフォワード経由で RDS に psql 接続する手順を表示する
[group('db')]
db-psql:
    @echo "SSM ポートフォワード経由で接続する。infra/data/README.md を参照"

# ------------------------------------------------------------------
# docker — turbo prune → build → ECR push
# ------------------------------------------------------------------

# turbo prune で剪定したワークスペースから api/worker 共用イメージをビルドする
[group('docker')]
image-build:
    pnpm exec turbo prune @repo/api @repo/worker --docker
    docker build -t aws-saas-playground:local .

# commit SHA タグで ECR に push する（M4 実装時に追加）
[group('docker')]
image-push:
    @echo "ECR ログイン + push は M4 実装時に追加する"

# ------------------------------------------------------------------
# cost — コスト実績と消し残しリソースの検出
# ------------------------------------------------------------------

# 当月の実績コストを Cost Explorer で確認する
[group('cost')]
cost-report:
    aws ce get-cost-and-usage \
        --time-period Start=$(date -v1d +%Y-%m-%d),End=$(date -v+1d +%Y-%m-%d) \
        --granularity MONTHLY \
        --metrics UnblendedCost

# 消し残しリソースを検出する（down の後に必ず実行）
[group('cost')]
leaks:
    aws ec2 describe-nat-gateways --filter Name=state,Values=available
    aws ec2 describe-addresses
    aws elbv2 describe-load-balancers
    aws rds describe-db-instances
    aws secretsmanager list-secrets --include-planned-deletion

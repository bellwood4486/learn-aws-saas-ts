# すべてのレシピを mise 経由で実行する。
# justfile は非対話シェルで走るため、nvm 等シェル関数ベースの PATH には乗らない。
# `mise exec --` を shell に噛ませることで、mise.toml が固定した node/pnpm/terraform 等を
# プロジェクトディレクトリから確実に解決する（M0 のゲート①で検証済み）。
set shell := ["mise", "exec", "--", "sh", "-c"]

infra_layers := "platform edge network data app"

# GitHub OIDC の信頼ポリシー（sub 条件）に使う "<owner>/<repo>"。
# origin の URL から導出して Terraform に渡す（ファイルに owner 名を直書きしないため）。
# 宣言していない層の TF_VAR_* は Terraform に無視されるので、全レシピに export してよい。
export TF_VAR_github_repository := `git remote get-url origin | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##'`

# ------------------------------------------------------------------
# session — 層をまたぐ apply / destroy のオーケストレーション
# ------------------------------------------------------------------

# ネットワーク → data → app → edge の順で常時起動していない層を apply する
[group('session')]
up:
    cd infra/network && terraform apply
    cd infra/data && terraform apply
    cd infra/app && terraform apply
    cd infra/edge && terraform apply -var="alb_dns_name=$(cd ../app && terraform output -raw alb_dns_name)"

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

# SSO セッションが切れたときに再ログインする
[group('session')]
aws-login:
    aws sso login

# ------------------------------------------------------------------
# tf — 層を引数に取る Terraform 操作
# ------------------------------------------------------------------

# 指定した層で terraform plan を実行する（例: just tf-plan platform）
[group('tf')]
tf-plan layer:
    cd infra/{{layer}} && terraform init -input=false -backend-config="bucket=$(cd ../bootstrap && terraform output -raw tfstate_bucket)" && terraform plan

# 指定した層で terraform apply を実行する
[group('tf')]
tf-apply layer:
    cd infra/{{layer}} && terraform init -input=false -backend-config="bucket=$(cd ../bootstrap && terraform output -raw tfstate_bucket)" && terraform apply

# 指定した層で terraform destroy を実行する（セッション毎レイヤー用）
[group('tf')]
[confirm('本当に指定した層の全リソースを destroy しますか？')]
tf-destroy layer:
    cd infra/{{layer}} && terraform init -input=false -backend-config="bucket=$(cd ../bootstrap && terraform output -raw tfstate_bucket)" && terraform destroy

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
    cd infra && tflint --recursive --config "$(pwd)/.tflint.hcl"

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
    pnpm exec biome ci .
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
    | pnpm --filter @repo/core exec node src/db/url.ts

# 生成済みの migration を RDS に適用する（db-tunnel を別ターミナルで開いておくこと）
[group('db')]
db-migrate:
    DATABASE_URL="$(just db-url)" pnpm --filter @repo/core exec drizzle-kit migrate

# 初期データを投入する（destroy → apply の後、毎回流し直す前提。db-tunnel を別ターミナルで開いておくこと）
[group('db')]
db-seed:
    DATABASE_URL="$(just db-url)" pnpm --filter @repo/core exec node src/db/seed.ts

# トンネル越しに接続してテーブル一覧と items の件数を表示する（psql 不要。db-tunnel を別ターミナルで開いておくこと）
[group('db')]
db-check:
    DATABASE_URL="$(just db-url)" pnpm --filter @repo/core exec node src/db/check.ts

# psql で接続する（別ターミナルで just db-tunnel を開いておくこと。psql は mise 管理外）
# db-url が返す sslmode=no-verify は libpq（psql）にとって未知の値でエラーになるため使えない。代わりに PGSSLMODE=require で接続する。
# パスワードは Secrets Manager にあり、`just db-url` が出す URL にも含まれているので、psql の対話プロンプトにはそこから拾って入力する
# psql で接続する（別ターミナルで just db-tunnel を開いておくこと。psql は mise 管理外）
[group('db')]
db-psql:
    PGSSLMODE=require psql -h localhost -p 5432 -U app -d app

# ------------------------------------------------------------------
# web — apps/web のビルドとedge層への配信
# ------------------------------------------------------------------

# apps/web をビルドする（.env.local の VITE_* を埋め込む。CI では workflow の env で渡す）。
# turbo 経由にして、依存する @repo/contracts の dist を先にビルドさせる
[group('web')]
web-build:
    pnpm exec turbo run build --filter=@repo/web

# ビルド成果物をedge層のS3バケットに同期し、CloudFrontのキャッシュをinvalidateする。
# WEB_BUCKET / CLOUDFRONT_DISTRIBUTION_ID を環境変数で渡すと terraform output を使わない（CI は tfstate に触れないため）
[group('web')]
web-deploy: web-build
    set -eu; \
    bucket="${WEB_BUCKET:-$(cd infra/edge && terraform output -raw web_bucket)}"; \
    distribution_id="${CLOUDFRONT_DISTRIBUTION_ID:-$(cd infra/edge && terraform output -raw cloudfront_distribution_id)}"; \
    aws s3 sync apps/web/dist "s3://$bucket" --delete; \
    aws cloudfront create-invalidation --distribution-id "$distribution_id" --paths '/*'

# ------------------------------------------------------------------
# docker — turbo prune → build → ECR push
# ------------------------------------------------------------------

# turbo prune で剪定したワークスペースから api/worker 共用イメージをビルドする。
# ECS タスクが ARM64 なので、ホストのアーキテクチャによらず arm64 イメージを作る
[group('docker')]
image-build:
    pnpm exec turbo prune @repo/api @repo/worker --docker
    docker build --platform linux/arm64 -t learn-aws-saas-ts:local .

# commit SHA（7桁）タグで ECR に発行する。同じタグが既にあれば何もしない（ECR は IMMUTABLE なので再 push は失敗する）。
# ECR_REPOSITORY_URL を環境変数で渡すと terraform output を使わない（CI は tfstate に触れないため）
[group('docker')]
image-push:
    set -eu; \
    repo_url="${ECR_REPOSITORY_URL:-$(cd infra/platform && terraform output -raw ecr_repository_url)}"; \
    tag="$(git rev-parse --short=7 HEAD)"; \
    if aws ecr describe-images --repository-name "${repo_url#*/}" --image-ids imageTag="$tag" >/dev/null 2>&1; then \
        echo "skip: $repo_url:$tag は発行済み"; \
    else \
        aws ecr get-login-password | docker login --username AWS --password-stdin "${repo_url%%/*}" && \
        docker tag learn-aws-saas-ts:local "$repo_url:$tag" && \
        docker push "$repo_url:$tag"; \
    fi

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
    aws ec2 describe-instances --filters Name=instance-state-name,Values=running,pending,stopping,stopped
    aws ec2 describe-addresses
    aws elbv2 describe-load-balancers
    aws rds describe-db-instances
    aws secretsmanager list-secrets --include-planned-deletion

# ------------------------------------------------------------------
# ci — GitHub Actions との連携
# ------------------------------------------------------------------

# terraform output の値を GitHub Actions の Variables に登録する。
# CI は tfstate に触れないため、常時起動層（platform / edge）の値を一度ここから渡す。
# 値はセッションをまたいで変わらないので、ロールやバケットを作り直したときだけ再実行する。
# 前提: gh auth login 済み（gh は mise の管轄外。brew で導入する）
[group('ci')]
gh-vars:
    gh variable set AWS_ROLE_ARN_PUBLISH --body "$(cd infra/platform && terraform output -raw github_publish_role_arn)"
    gh variable set AWS_ROLE_ARN_DEPLOY_API --body "$(cd infra/platform && terraform output -raw github_deploy_api_role_arn)"
    gh variable set ECR_REPOSITORY_URL --body "$(cd infra/platform && terraform output -raw ecr_repository_url)"
    gh variable set COGNITO_CLIENT_ID --body "$(cd infra/platform && terraform output -raw cognito_user_pool_client_id)"
    gh variable set AWS_ROLE_ARN_DEPLOY_WEB --body "$(cd infra/edge && terraform output -raw github_deploy_web_role_arn)"
    gh variable set WEB_BUCKET --body "$(cd infra/edge && terraform output -raw web_bucket)"
    gh variable set CLOUDFRONT_DISTRIBUTION_ID --body "$(cd infra/edge && terraform output -raw cloudfront_distribution_id)"

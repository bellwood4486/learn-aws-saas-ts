# learn-aws-saas-ts

AWS SaaS バックエンドの定番構成（コンテナ / RDB / NoSQL / キュー / シークレットマネージャー / S3 / CloudFront+Cognito）を Terraform と TypeScript モノレポで学ぶためのプロジェクト。

設計の詳細と各マイルストーンの内容は [`docs/superpowers/specs/2026-08-15-aws-saas-backend-design.md`](docs/superpowers/specs/2026-08-15-aws-saas-backend-design.md) を参照。

## セットアップ

```sh
mise trust
mise install       # node/pnpm/terraform/just/tflint/awscli/hadolint/gitleaks/actionlint を固定バージョンで導入
pnpm install
pre-commit install
```

AWS 認証は SSO（`AWS_PROFILE=personal`）を前提とする。`mise.toml` の `[env]` で固定済み。

## コマンド

すべて `justfile` に集約している。索引として一覧を確認できる:

```sh
just --list
```

主なもの:

| コマンド | 内容 |
|---|---|
| `just typecheck` / `just test` / `just lint` | 品質チェック（turbo 経由） |
| `just tf-plan <layer>` | 指定した層で `terraform plan` |
| `just up` / `just down` | セッション毎に立てる層（network/data/app/edge）をまとめて apply / destroy |
| `just leaks` | `down` の後に消し残しリソースを確認する（**必ず実行**） |
| `just dev-all` | ローカルで api + web を同時起動（api を実AWSのnetwork/data層に繋ぐ場合は下記「ローカルでのフロントエンド確認」を参照） |
| `just web-deploy` | `apps/web` をビルドしてedge層のS3に同期、CloudFrontキャッシュをinvalidate |
| `just gh-vars` | `terraform output` の値を GitHub Actions の Variables に登録する（初回とロール/バケットの作り直し時） |

## CI/CD（M8）

CI（検証）と CD（発行・反映）を別の workflow に分け、CD は依存するインフラのライフサイクルで分けている。詳しい設計は spec の「CI/CD」節を参照。

| workflow | 責務 | トリガー | AWS |
|---|---|---|---|
| `ci.yml` | 検証のみ（typecheck / test / lint / terraform validate / docker build） | 全ブランチの push | 触らない |
| `publish-image.yml` | api/worker イメージを 7 桁 commit SHA タグで ECR に発行 | main の CI 成功後 | ECR |
| `deploy-web.yml` | `apps/web` を S3 に同期し CloudFront を invalidate | main の CI 成功後 | S3 / CloudFront |
| `deploy-api.yml` | 発行済みイメージを ECS の api / worker に反映 | 手動（`workflow_dispatch`） | ECS |

認証は GitHub OIDC（アクセスキーなし）。3 本のロールはどれも `main` ブランチの workflow からしか assume できない。

### 初回セットアップ

1. `gh auth login`（`gh` は mise の管轄外。`brew install gh`）
2. `just tf-apply platform` → `just tf-apply edge`（OIDC provider とロールを作る。**apply 順は platform → edge**）
   - アカウントに GitHub の OIDC provider が既にある場合は、先に `terraform import aws_iam_openid_connect_provider.github <ARN>` で取り込む（詳細は [`infra/platform/README.md`](infra/platform/README.md)）
3. `just gh-vars`（ロール ARN・ECR URL・バケット名などを GitHub Actions の Variables に登録する。すべて非秘匿の値で、Secrets は使わない）

### api を ECS に反映する

`app/` はセッション毎に destroy されるため、`deploy-api` は `just up` の後にだけ成功する。

1. ローカルで `TF_VAR_image_tag=<発行済みの 7 桁 SHA> just up`
2. GitHub の Actions タブ、または `gh workflow run deploy-api.yml -f image_tag=<7 桁 SHA>` で実行する（`image_tag` を省略すると起動した ref の HEAD）

`app/` が無い状態で実行すると「app 層が apply されていません」で落ちる。`just down` の後の実行も同様。

### 注意

- `terraform` を直接叩くとき、platform / edge は `TF_VAR_github_repository`（`<owner>/<repo>`）が要る。`just` 経由なら justfile が origin の URL から導出して渡す
- `mise.toml` の `AWS_PROFILE=personal` は外から渡した環境変数を上書きするため、CI では `MISE_ENV=ci`（`mise.ci.toml`）で unset している
- フィーチャーブランチではイメージは発行されない（main の CI 成功後のみ）

## コスト運用

月 $10 の予算アラートを前提に、常時起動する層（`platform` / `edge`）と、触るときだけ apply する層（`network` / `data` / `app`）を分けている。**セッションの終わりには必ず `just down` → `just leaks` → `just cost-report` を実行し、NAT Gateway / Elastic IP / ALB / RDS / 削除待ちシークレットが残っていないことを確認する。**

詳しい理由は spec ドキュメントの「シークレットと destroy 運用」を参照。

## ローカルでのフロントエンド確認（M6 実機検証で判明した注意点）

`just dev-all` で `apps/web` からログイン・item作成・一覧確認をする場合、`apps/api` を実 AWS（`network`/`data` 層）に繋いで動かす必要がある。

セットアップ手順:

1. `network`/`data`/`platform` 層を apply 済みにしておく（`network`/`data` は課金対象。使い終わったら `just down` を忘れずに）
2. `just db-tunnel` で RDS への SSM トンネルを張る（別ターミナルで張りっぱなしにする）
3. `cp apps/web/.env.template apps/web/.env.local` を実行し、`infra/platform` で `terraform output -raw cognito_user_pool_client_id` した値を `VITE_COGNITO_CLIENT_ID` に設定する（`VITE_AWS_REGION` はデフォルトのままでよい）
4. `apps/api` 起動用の環境変数を、`just dev-all` を実行するのと同じシェルで export する:
   ```sh
   cd infra/platform
   export ITEMS_TABLE_NAME="$(terraform output -raw items_table_name)"
   export ITEMS_QUEUE_URL="$(terraform output -raw items_queue_url)"
   export COGNITO_USER_POOL_ID="$(terraform output -raw cognito_user_pool_id)"
   export COGNITO_CLIENT_ID="$(terraform output -raw cognito_user_pool_client_id)"
   cd ../data
   export DB_SECRET_ARN="$(terraform output -raw db_secret_arn)"
   export DB_HOST=localhost
   export DB_PORT=5432
   cd ../..
   ```
5. 同じシェルで `just dev-all` を実行する

その際の注意点:

- **`just db-seed` で投入した初期データは `GET /api/items` で 500 エラーになる。** `db-seed` は RDS にしか行を insert せず、DynamoDB 側の status レコードを作らない。`listItems`（M6 で追加）は RDS の全行について DynamoDB の status を要求するため、`db-seed` 由来の行はここで例外を投げる。ブラウザ確認をする際は `db-seed` を実行しない（または先に `items` テーブルを空にする）か、`apps/web` からの作成（`createItem` 経由。RDS + DynamoDB を両方書く）だけで一覧を確認する。
- **`apps/api` をローカルの `node --watch src/main.ts` で実 AWS の RDS に繋ぐには `DB_HOST=localhost DB_PORT=5432`（`just db-tunnel` の SSM トンネル経由）を環境変数で渡す。** 未設定なら Secrets Manager の secret に入っている本番相当のホスト名（ECS/Fargate 用）にそのまま繋ぎに行き、ローカルからは到達できない。

## CloudFront経由の本番配信確認（M7 実機検証で判明した注意点）

`infra/edge/`（S3 + CloudFront）は常時起動層。フロントを配信し `/api/*` をALB（`network`/`data`/`app`が apply済みのときのみ）にプロキシする。手順・詳細は [`infra/edge/README.md`](infra/edge/README.md) を参照。

- `just up` を実行する前に、`network`/`data`/`app`/`edge` の各層で `terraform init` 済みであること（新規 worktree では全層でやり直しが必要）
- `just up` 後、`GET /api/items` はRDSが空（`items` テーブル未作成）のため500になる。`just db-tunnel` → `just db-migrate` を実行してから確認する
- `just up` の `edge` 再apply行にあったバグ（`alb_dns_name` が渡らない）はM7で修正済み。`/api/*` がCloudFront経由で401ではなくエラーになる場合は、`infra/edge` の `terraform apply` の `alb_dns_name` に正しいALB DNS名が渡っているか確認する

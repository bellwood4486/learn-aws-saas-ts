# platform

常時起動する土台リソースを作る層。S3（アプリ用オブジェクト）、DynamoDB（`items` テーブル）、SQS+DLQ、ECR（api/worker 共用）、アプリ用シークレット、Cognito User Pool/App Clientを持つ。

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
| `cognito_user_pool_id` | Cognito User Pool の ID |
| `cognito_user_pool_client_id` | Cognito App Client の ID |
| `github_publish_role_arn` | publish-image.yml が assume するロールの ARN |
| `github_deploy_api_role_arn` | deploy-api.yml が assume するロールの ARN |

## 注意

- **GitHub OIDC provider と CI/CD 用ロール 2 本（`github_publish` / `github_deploy_api`）はこの層にある。** `github_deploy_web` は権限の対象（S3 / CloudFront）と同じ `infra/edge/` にある。3 ロールとも信頼ポリシーの `sub` は `repo:<owner>/<repo>:ref:refs/heads/main` のみ。`<owner>/<repo>` は `var.github_repository`（デフォルト無し）で受け、justfile が origin の URL から `TF_VAR_github_repository` として渡す。terraform を直接叩くときは同じ環境変数を渡す
- OIDC provider はアカウントに同じ URL のものを 1 つしか作れない。既に存在する場合は `terraform import aws_iam_openid_connect_provider.github <ARN>` で取り込む
- **`edge/` はこの層の OIDC provider を data source で参照するため、apply 順は `platform/` → `edge/`**
- アプリ用シークレットの値はダミー（`REPLACE_ME`）。実際の外部 API キーは持たない
- ECR は `image_tag_mutability = "IMMUTABLE"`。`latest` タグは使わず commit SHA でタグ付けする運用（M8）に合わせている
- 常時起動層なので `just down` の対象外

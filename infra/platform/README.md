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

## 注意

- **GitHub OIDC provider/role はこの層には無い。** 使うタイミング（M8, CI/CD）に合わせて作るため、まだ追加していない
- アプリ用シークレットの値はダミー（`REPLACE_ME`）。実際の外部 API キーは持たない
- ECR は `image_tag_mutability = "IMMUTABLE"`。`latest` タグは使わず commit SHA でタグ付けする運用（M8）に合わせている
- 常時起動層なので `just down` の対象外

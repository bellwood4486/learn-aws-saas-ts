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

output "items_table_arn" {
  description = "items DynamoDB テーブルの ARN。M4のtask roleが参照する。"
  value       = aws_dynamodb_table.items.arn
}

output "items_queue_url" {
  description = "items SQS キューの URL。"
  value       = aws_sqs_queue.items.url
}

output "items_queue_arn" {
  description = "items SQS キューの ARN。M4のtask roleが参照する。"
  value       = aws_sqs_queue.items.arn
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

output "cognito_user_pool_id" {
  description = "Cognito User Pool の ID。api の JWT 検証（issuer）、動作確認用ユーザー作成で使う。"
  value       = aws_cognito_user_pool.app.id
}

output "cognito_user_pool_client_id" {
  description = "Cognito App Client の ID。api の JWT 検証（aud）、動作確認用トークン取得で使う。"
  value       = aws_cognito_user_pool_client.web.id
}

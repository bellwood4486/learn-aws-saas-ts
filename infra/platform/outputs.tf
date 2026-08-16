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

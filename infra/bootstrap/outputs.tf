output "tfstate_bucket" {
  description = "他の全層が backend として使う S3 バケット名。"
  value       = aws_s3_bucket.tfstate.bucket
}

output "tfstate_bucket_arn" {
  description = "tfstate バケットの ARN。"
  value       = aws_s3_bucket.tfstate.arn
}

output "aws_region" {
  description = "全層で共通して使うリージョン。"
  value       = var.aws_region
}

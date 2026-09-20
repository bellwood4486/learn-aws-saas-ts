output "web_bucket" {
  description = "フロント配信用バケット名。`just web-deploy` の sync 先。"
  value       = aws_s3_bucket.web.bucket
}

output "web_bucket_arn" {
  description = "フロント配信用バケットのARN。"
  value       = aws_s3_bucket.web.arn
}

output "cloudfront_domain_name" {
  description = "CloudFrontのドメイン名（*.cloudfront.net）。ブラウザで開くURLはこの値の先頭にhttps://を付けたもの。"
  value       = aws_cloudfront_distribution.web.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID。`just web-deploy` のキャッシュinvalidateで使う。"
  value       = aws_cloudfront_distribution.web.id
}

output "aws_region" {
  description = "全層で共通のリージョン。"
  value       = var.aws_region
}

output "github_deploy_web_role_arn" {
  description = "deploy-web.yml が assume するロールの ARN。`just gh-vars` が GitHub Variables に登録する。"
  value       = aws_iam_role.github_deploy_web.arn
}

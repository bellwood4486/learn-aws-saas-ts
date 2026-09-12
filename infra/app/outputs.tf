output "alb_dns_name" {
  description = "ALB の DNS 名。curlでの動作確認に使う。M7でedge層がCloudFrontオリジンとして使う。"
  value       = aws_lb.app.dns_name
}

output "ecs_cluster_name" {
  description = "ECS クラスタ名。"
  value       = aws_ecs_cluster.app.name
}

output "aws_region" {
  description = "全層で共通のリージョン。"
  value       = var.aws_region
}

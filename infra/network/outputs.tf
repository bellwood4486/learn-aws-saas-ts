output "vpc_id" {
  description = "network 層で作成した VPC の ID。"
  value       = aws_vpc.app.id
}

output "public_subnet_ids" {
  description = "public subnet（ALB配置用）の ID 一覧。"
  value       = [aws_subnet.public_1a.id, aws_subnet.public_1c.id]
}

output "private_subnet_ids" {
  description = "private subnet（ECSタスク・RDS配置用）の ID 一覧。"
  value       = [aws_subnet.private_1a.id, aws_subnet.private_1c.id]
}

output "alb_security_group_id" {
  description = "ALB に付与する SG の ID。"
  value       = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  description = "ECS タスクに付与する SG の ID。"
  value       = aws_security_group.ecs.id
}

output "rds_security_group_id" {
  description = "RDS に付与する SG の ID。"
  value       = aws_security_group.rds.id
}

output "bastion_security_group_id" {
  description = "SSM 踏み台 EC2 に付与する SG の ID。"
  value       = aws_security_group.bastion.id
}

output "nat_gateway_id" {
  description = "NAT Gateway の ID（参考情報）。"
  value       = aws_nat_gateway.app.id
}

output "aws_region" {
  description = "全層で共通のリージョン。"
  value       = var.aws_region
}

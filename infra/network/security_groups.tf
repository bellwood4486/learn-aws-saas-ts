resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "Security group for ALB. Allows HTTP/HTTPS from the internet."
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-alb"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# 素の aws_security_group は AWS のデフォルト全許可egressルールをTerraformが削除するため、
# 疎通に必要なegressは明示的に用意する（ingressと同じattachment resourceパターン）。
resource "aws_vpc_security_group_egress_rule" "alb_to_ecs" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "ecs" {
  name        = "${var.project_name}-ecs"
  description = "Security group for ECS tasks. Allows the app port from ALB only."
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-ecs"
  }
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "ecs_to_rds" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.rds.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

# NAT Gateway経由でECR pull・Secrets Manager・CloudWatch Logs等のAWS管理HTTPSエンドポイントに到達するため。
resource "aws_vpc_security_group_egress_rule" "ecs_https" {
  security_group_id = aws_security_group.ecs.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds"
  description = "Security group for RDS. Allows PostgreSQL from ECS tasks only."
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-rds"
  }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_ecs" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "bastion" {
  name        = "${var.project_name}-bastion"
  description = "Security group for the SSM bastion host. No ingress; SSM Agent dials out."
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${var.project_name}-bastion"
  }
}

# ingress は無い。SSM Session Manager は Agent 側から HTTPS で接続しに行くだけなので、
# 踏み台に対する inbound は一切不要（SSH 鍵も踏み台への 22 番も持たない）。

# SSM Agent が ssm/ssmmessages/ec2messages エンドポイントへ到達するため（NAT Gateway 経由）。
resource "aws_vpc_security_group_egress_rule" "bastion_https" {
  security_group_id = aws_security_group.bastion.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# AWS-StartPortForwardingSessionToRemoteHost は踏み台を起点に RDS へ TCP を張る。
# 素の aws_security_group はデフォルト全許可 egress が削除されるため、
# この 5432 egress が無いとポートフォワードがタイムアウトする。
resource "aws_vpc_security_group_egress_rule" "bastion_to_rds" {
  security_group_id            = aws_security_group.bastion.id
  referenced_security_group_id = aws_security_group.rds.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_bastion" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.bastion.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

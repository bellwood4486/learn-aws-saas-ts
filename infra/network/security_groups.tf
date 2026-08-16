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

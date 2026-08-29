resource "aws_db_subnet_group" "app" {
  name        = "${var.project_name}-app"
  description = "Private subnets for the app database."
  subnet_ids  = data.terraform_remote_state.network.outputs.private_subnet_ids

  tags = {
    Name = "${var.project_name}-app"
  }
}

# 空の箱にせず、クライアント接続の TLS を強制する。
# rds.force_ssl は動的パラメータ（aws rds describe-db-parameters の ApplyType: dynamic）なので
# apply_method = "immediate" で即時反映できる。PostgreSQL 16 以降はエンジン既定値が既に 1 のため、
# この設定は挙動を変えるものではなく意図を明示するためのもの。そのため describe-db-parameters
# --source user は空リストを返す（既定値と同じ値を設定した場合の正しい挙動）。
resource "aws_db_parameter_group" "app" {
  name        = "${var.project_name}-app"
  description = "Parameter group for the app database. Forces TLS."
  family      = "postgres${var.db_engine_version}"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "immediate"
  }

  tags = {
    Name = "${var.project_name}-app"
  }
}

resource "aws_db_instance" "app" {
  identifier     = "${var.project_name}-app"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  # admin / postgres のような推測されやすい名前を避ける。
  db_name  = "app"
  username = "app"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.app.name
  parameter_group_name   = aws_db_parameter_group.app.name
  vpc_security_group_ids = [data.terraform_remote_state.network.outputs.rds_security_group_id]
  publicly_accessible    = false
  multi_az               = false

  # セッション毎に destroy する学習環境。データは消える前提で、状態を決定的にする。
  skip_final_snapshot     = true
  deletion_protection     = false
  backup_retention_period = 0
  apply_immediately       = true

  tags = {
    Name = "${var.project_name}-app"
  }
}

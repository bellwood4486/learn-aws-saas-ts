variable "aws_region" {
  description = "リソースを作る AWS リージョン。"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "リソース名のプレフィックスとして使うプロジェクト名。"
  type        = string
  default     = "learn-aws-saas-ts"
}

variable "db_instance_class" {
  description = "RDS のインスタンスクラス。学習用途の最小構成。"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "PostgreSQL のメジャーバージョン。マイナーは AWS に任せる。"
  type        = string
  default     = "17"
}

variable "db_allocated_storage" {
  description = "RDS のストレージ容量（GiB）。gp3 の最小値。"
  type        = number
  default     = 20
}

variable "bastion_instance_type" {
  description = "SSM 踏み台 EC2 のインスタンスタイプ（Graviton の最小）。"
  type        = string
  default     = "t4g.nano"
}

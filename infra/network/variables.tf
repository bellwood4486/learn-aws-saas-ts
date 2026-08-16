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

variable "app_port" {
  description = "ECS タスクで動く api コンテナがリッスンするポート。ALB からの ingress を許可するために使う。"
  type        = number
  default     = 3000
}

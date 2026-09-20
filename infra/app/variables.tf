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
  description = "api コンテナがリッスンするポート。network 層の SG（var.app_port）と同じ値にする。"
  type        = number
  default     = 3000
}

variable "image_tag" {
  description = "ECR に発行した api/worker 共用イメージのタグ（7桁の commit SHA。`git rev-parse --short=7 HEAD`）。ECR は IMMUTABLE のため latest 固定にはできない。main の publish-image、またはローカルの `just image-push` が発行する。デフォルト無し（apply/destroyともに明示指定が必要）。"
  type        = string
}

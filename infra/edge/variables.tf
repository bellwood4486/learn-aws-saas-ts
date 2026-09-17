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

variable "alb_dns_name" {
  description = "app層のALBのDNS名。空文字なら /api/* オリジンとビヘイビアを作らない（app層が未apply/destroy済みのときのデフォルト）。`just up` がapp層apply後にこの値付きでedgeを再applyする。"
  type        = string
  default     = ""
}

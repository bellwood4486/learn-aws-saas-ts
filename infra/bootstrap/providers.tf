provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "learn-aws-saas-ts"
      ManagedBy = "terraform"
      Layer     = "bootstrap"
    }
  }
}

# tfstate バケット自身を作る層なので、この層だけ local state を使い、リポジトリに commit する。
# 他の全層はここで作るバケットを S3 backend として使う。

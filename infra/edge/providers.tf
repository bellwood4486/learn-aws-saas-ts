terraform {
  backend "s3" {
    key          = "edge/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "learn-aws-saas-ts"
      ManagedBy = "terraform"
      Layer     = "edge"
    }
  }
}

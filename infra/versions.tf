terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Remote state in S3 so CI runs share state. The bucket is created (idempotently)
  # by the deploy workflow before `terraform init`.
  backend "s3" {
    bucket  = "mise-tfstate-765607524925"
    key     = "mise/eu-west-2/terraform.tfstate"
    region  = "eu-west-2"
    encrypt = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "mise"
      ManagedBy = "terraform"
    }
  }
}

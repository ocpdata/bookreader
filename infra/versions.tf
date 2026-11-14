terraform {
  required_version = ">= 1.6.0"

  # Estado en un workspace propio de Terraform Cloud (modo de ejecución "Local":
  # Terraform corre en GitHub Actions y Terraform Cloud solo guarda el estado).
  cloud {
    organization = "OCPData"

    workspaces {
      name = "bookreader"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 7.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      app        = "bookreader"
      managed_by = "terraform"
    }
  }
}

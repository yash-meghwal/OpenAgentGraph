module "vpc" {
  source = "./modules/vpc"
}

resource "aws_s3_bucket" "logs" {
  bucket = "fixture-logs"
}
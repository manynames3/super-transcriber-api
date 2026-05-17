provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix    = lower("${var.project_name}-${var.environment}")
  s3_name_prefix = replace(local.name_prefix, "_", "-")

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "super-transcriber-api"
  }

  lambda_environment = {
    ADMIN_TOKEN                   = var.admin_token
    BUILD_VERSION                 = var.build_version
    DEFAULT_LANGUAGE_CODE         = var.default_language_code
    MAX_ACTIVE_JOBS               = tostring(var.max_active_jobs)
    MAX_DURATION_SECONDS          = tostring(var.max_duration_seconds)
    MAX_FILE_SIZE_BYTES           = tostring(var.max_file_size_bytes)
    MONTHLY_TRANSCRIPTION_MINUTES = tostring(var.monthly_transcription_minutes)
    STRIPE_ENABLED                = var.stripe_secret_arn == "" ? "false" : "true"
    STRIPE_SECRET_ARN             = var.stripe_secret_arn
    TABLE_NAME                    = aws_dynamodb_table.main.name
    TRANSCRIPT_BUCKET             = aws_s3_bucket.transcripts.bucket
    TRANSCRIPT_PRESIGN_SECONDS    = tostring(var.transcript_presign_seconds)
    UPLOAD_BUCKET                 = aws_s3_bucket.uploads.bucket
    UPLOAD_PRESIGN_SECONDS        = tostring(var.upload_presign_seconds)
  }

  lambda_functions = {
    health = {
      filename    = "${path.module}/../lambda/dist/zips/health.zip"
      memory_size = 128
      timeout     = 5
    }
    create-api-key = {
      filename    = "${path.module}/../lambda/dist/zips/create-api-key.zip"
      memory_size = 128
      timeout     = 10
    }
    presign-upload = {
      filename    = "${path.module}/../lambda/dist/zips/presign-upload.zip"
      memory_size = 128
      timeout     = 10
    }
    create-transcription = {
      filename    = "${path.module}/../lambda/dist/zips/create-transcription.zip"
      memory_size = 256
      timeout     = 30
    }
    get-transcription = {
      filename    = "${path.module}/../lambda/dist/zips/get-transcription.zip"
      memory_size = 256
      timeout     = 15
    }
    list-transcriptions = {
      filename    = "${path.module}/../lambda/dist/zips/list-transcriptions.zip"
      memory_size = 128
      timeout     = 10
    }
    delete-transcription = {
      filename    = "${path.module}/../lambda/dist/zips/delete-transcription.zip"
      memory_size = 128
      timeout     = 10
    }
    completion = {
      filename    = "${path.module}/../lambda/dist/zips/completion.zip"
      memory_size = 256
      timeout     = 30
    }
  }
}

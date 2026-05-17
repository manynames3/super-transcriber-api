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
    ADMIN_TOKEN_SECRET_ARN                = local.admin_token_secret_arn
    AI_ENRICHMENT_ENABLED                 = tostring(var.enable_ai_enrichment)
    AI_ENRICHMENT_MAX_CHARS               = tostring(var.ai_enrichment_max_chars)
    AI_ENRICHMENT_MAX_TOKENS              = tostring(var.ai_enrichment_max_tokens)
    BEDROCK_MODEL_ID                      = var.bedrock_model_id
    BILLING_PLAN_LIMITS_JSON              = jsonencode(var.billing_plan_limits)
    BUILD_VERSION                         = var.build_version
    DEFAULT_LANGUAGE_CODE                 = var.default_language_code
    ENRICHMENT_QUEUE_URL                  = aws_sqs_queue.enrichment.url
    MAX_ACTIVE_JOBS                       = tostring(var.max_active_jobs)
    MAX_DURATION_SECONDS                  = tostring(var.max_duration_seconds)
    MAX_FILE_SIZE_BYTES                   = tostring(var.max_file_size_bytes)
    MONTHLY_TRANSCRIPTION_MINUTES         = tostring(var.monthly_transcription_minutes)
    STRIPE_ENABLED                        = var.stripe_secret_arn == "" ? "false" : "true"
    STRIPE_PRICE_IDS_JSON                 = jsonencode(var.stripe_price_ids)
    STRIPE_SECRET_ARN                     = var.stripe_secret_arn
    STRIPE_WEBHOOK_SECRET_ARN             = var.stripe_webhook_secret_arn
    TABLE_NAME                            = aws_dynamodb_table.main.name
    TRANSCRIPTION_START_MAX_RECEIVE_COUNT = tostring(var.transcription_start_max_receive_count)
    TRANSCRIPT_BUCKET                     = aws_s3_bucket.transcripts.bucket
    TRANSCRIPT_PRESIGN_SECONDS            = tostring(var.transcript_presign_seconds)
    TRANSCRIPTION_START_QUEUE_URL         = aws_sqs_queue.transcription_start.url
    UPLOAD_BUCKET                         = aws_s3_bucket.uploads.bucket
    UPLOAD_PRESIGN_SECONDS                = tostring(var.upload_presign_seconds)
    WEBHOOK_DELIVERY_QUEUE_URL            = aws_sqs_queue.webhook_delivery.url
    WEBHOOK_TIMEOUT_MS                    = tostring(var.webhook_timeout_ms)
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
    create-checkout-session = {
      filename    = "${path.module}/../lambda/dist/zips/create-checkout-session.zip"
      memory_size = 128
      timeout     = 15
    }
    stripe-webhook = {
      filename    = "${path.module}/../lambda/dist/zips/stripe-webhook.zip"
      memory_size = 128
      timeout     = 15
    }
    claim-checkout-session = {
      filename    = "${path.module}/../lambda/dist/zips/claim-checkout-session.zip"
      memory_size = 128
      timeout     = 15
    }
    get-billing-account = {
      filename    = "${path.module}/../lambda/dist/zips/get-billing-account.zip"
      memory_size = 128
      timeout     = 10
    }
    create-billing-portal = {
      filename    = "${path.module}/../lambda/dist/zips/create-billing-portal.zip"
      memory_size = 128
      timeout     = 15
    }
    configure-webhook = {
      filename    = "${path.module}/../lambda/dist/zips/configure-webhook.zip"
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
    start-transcription = {
      filename    = "${path.module}/../lambda/dist/zips/start-transcription.zip"
      memory_size = 256
      timeout     = 60
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
    deliver-webhook = {
      filename    = "${path.module}/../lambda/dist/zips/deliver-webhook.zip"
      memory_size = 128
      timeout     = 20
    }
    enrich-transcript = {
      filename    = "${path.module}/../lambda/dist/zips/enrich-transcript.zip"
      memory_size = 512
      timeout     = 60
    }
  }
}

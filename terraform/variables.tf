variable "project_name" {
  type        = string
  description = "Project name used in AWS resource names and tags."
  default     = "super-transcriber-api"
}

variable "api_key_requests_per_minute" {
  type        = number
  default     = 120
  description = "Per-key fixed-window request limit, enforced with TTL counters."
  validation {
    condition     = var.api_key_requests_per_minute > 0 && floor(var.api_key_requests_per_minute) == var.api_key_requests_per_minute
    error_message = "Request limit must be a positive integer."
  }
}

variable "billing_success_url" {
  type        = string
  default     = "https://super-transcriber-api.pages.dev/billing"
  description = "Hosted receipt page for optional Stripe Checkout."
}

variable "enable_job_reconciliation" {
  type        = bool
  default     = true
  description = "Enable hourly bounded recovery of pending events and stale jobs."
}

variable "environment" {
  type        = string
  description = "Deployment environment name."
  default     = "dev"
}

variable "enable_sqs_workers" {
  type        = bool
  description = "Enable Lambda SQS event-source mappings. Defaults off for dev, development, and local; defaults on elsewhere."
  default     = null
}

variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "us-east-1"
}

variable "admin_token" {
  type        = string
  description = "Admin token to store in Secrets Manager for POST /v1/api-keys. Prefer admin_token_secret_arn for shared environments."
  sensitive   = true
  default     = ""
}

variable "admin_token_secret_arn" {
  type        = string
  description = "Existing Secrets Manager ARN containing the admin token. If set, Terraform does not create an admin token secret."
  default     = ""
}

variable "build_version" {
  type        = string
  description = "Version string returned by GET /health."
  default     = "local"
}

variable "default_language_code" {
  type        = string
  description = "Default Amazon Transcribe language code."
  default     = "en-US"
}

variable "cors_allowed_origins" {
  type        = list(string)
  description = "Allowed CORS origins for the HTTP API."
  default     = ["*"]
}

variable "cors_allowed_headers" {
  type        = list(string)
  description = "Allowed CORS request headers."
  default     = ["authorization", "content-type", "x-api-key", "x-admin-token"]
}

variable "cors_allowed_methods" {
  type        = list(string)
  description = "Allowed CORS methods."
  default     = ["GET", "POST", "DELETE", "OPTIONS"]
}

variable "max_active_jobs" {
  type        = number
  description = "Default maximum active jobs per API key customer."
  default     = 5
}

variable "max_file_size_bytes" {
  type        = number
  description = "Default maximum upload size in bytes."
  default     = 209715200
}

variable "max_duration_seconds" {
  type        = number
  description = "Default maximum audio duration in seconds."
  default     = 1200
}

variable "monthly_transcription_minutes" {
  type        = number
  description = "Default monthly transcription minute limit."
  default     = 120
}

variable "upload_presign_seconds" {
  type        = number
  description = "Presigned upload URL lifetime in seconds."
  default     = 900
}

variable "transcript_presign_seconds" {
  type        = number
  description = "Presigned transcript JSON URL lifetime in seconds."
  default     = 900
}

variable "upload_retention_days" {
  type        = number
  description = "Days to retain uploaded audio files."
  default     = 7
}

variable "transcript_retention_days" {
  type        = number
  description = "Days to retain transcript JSON files."
  default     = 30
}

variable "force_destroy_buckets" {
  type        = bool
  description = "Allow Terraform destroy to delete non-empty buckets in development."
  default     = false
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention for Lambda log groups."
  default     = 14
}

variable "enable_cloudwatch_alarms" {
  type        = bool
  description = "Create basic CloudWatch alarms for Lambda errors and DLQ depth."
  default     = false
}

variable "enable_point_in_time_recovery" {
  type        = bool
  description = "Enable DynamoDB point-in-time recovery. Disabled by default for cost control."
  default     = false
}

variable "api_throttle_burst_limit" {
  type        = number
  description = "HTTP API stage burst throttle limit."
  default     = 50
}

variable "api_throttle_rate_limit" {
  type        = number
  description = "HTTP API stage steady-state throttle rate."
  default     = 25
}

variable "lambda_reserved_concurrency" {
  type        = number
  description = "Reserved concurrency per Lambda. Use -1 for unreserved account concurrency."
  default     = -1
}

variable "transcription_start_max_receive_count" {
  type        = number
  description = "Maximum SQS receive attempts before a queued transcription start is marked failed."
  default     = 3
}

variable "webhook_max_receive_count" {
  type        = number
  description = "Maximum SQS receive attempts before webhook delivery moves to DLQ."
  default     = 5
}

variable "webhook_timeout_ms" {
  type        = number
  description = "Webhook HTTP request timeout in milliseconds."
  default     = 10000
}

variable "enable_ai_enrichment" {
  type        = bool
  description = "Enable optional Bedrock-powered transcript enrichment after completion."
  default     = false
}

variable "bedrock_model_id" {
  type        = string
  description = "Bedrock model id used for optional AI enrichment."
  default     = "anthropic.claude-3-haiku-20240307-v1:0"
}

variable "ai_enrichment_max_chars" {
  type        = number
  description = "Maximum transcript characters sent to the optional enrichment model."
  default     = 12000
}

variable "ai_enrichment_max_tokens" {
  type        = number
  description = "Maximum output tokens requested from the optional enrichment model."
  default     = 1200
}

variable "stripe_secret_arn" {
  type        = string
  description = "Optional Secrets Manager ARN containing the Stripe secret key. Empty keeps Stripe billing disabled."
  default     = ""
}

variable "stripe_webhook_secret_arn" {
  type        = string
  description = "Optional Secrets Manager ARN containing the Stripe webhook signing secret."
  default     = ""
}

variable "stripe_price_ids" {
  type        = map(string)
  description = "Map of billing plan ids to Stripe recurring price ids."
  default     = {}
}

variable "billing_plan_limits" {
  type = map(object({
    name                        = optional(string)
    maxActiveJobs               = number
    maxFileSizeBytes            = number
    maxDurationSeconds          = number
    monthlyTranscriptionMinutes = number
    enrichmentEnabled           = optional(bool)
    webhookEnabled              = optional(bool)
  }))
  description = "Plan limits applied to API keys created through Stripe checkout."
  default = {
    starter = {
      name                        = "Starter"
      maxActiveJobs               = 5
      maxFileSizeBytes            = 209715200
      maxDurationSeconds          = 1200
      monthlyTranscriptionMinutes = 120
      enrichmentEnabled           = false
      webhookEnabled              = true
    }
    team = {
      name                        = "Team"
      maxActiveJobs               = 25
      maxFileSizeBytes            = 209715200
      maxDurationSeconds          = 3600
      monthlyTranscriptionMinutes = 1500
      enrichmentEnabled           = true
      webhookEnabled              = true
    }
  }
}

variable "project_name" {
  type        = string
  description = "Project name used in AWS resource names and tags."
  default     = "super-transcriber-api"
}

variable "environment" {
  type        = string
  description = "Deployment environment name."
  default     = "dev"
}

variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "us-east-1"
}

variable "admin_token" {
  type        = string
  description = "Bearer token for POST /v1/api-keys. Leave empty to disable the admin route."
  sensitive   = true
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

variable "stripe_secret_arn" {
  type        = string
  description = "Optional Secrets Manager ARN for Stripe credentials. Empty keeps Stripe disabled."
  default     = ""
}

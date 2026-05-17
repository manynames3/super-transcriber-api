output "api_endpoint" {
  description = "HTTP API base URL."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "dynamodb_table_name" {
  description = "DynamoDB single-table name."
  value       = aws_dynamodb_table.main.name
}

output "uploads_bucket_name" {
  description = "Private S3 bucket for uploaded audio."
  value       = aws_s3_bucket.uploads.bucket
}

output "transcripts_bucket_name" {
  description = "Private S3 bucket for transcript JSON output."
  value       = aws_s3_bucket.transcripts.bucket
}

output "completion_dlq_url" {
  description = "SQS DLQ URL for EventBridge completion target failures."
  value       = aws_sqs_queue.transcribe_completion_dlq.url
}

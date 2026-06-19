resource "aws_sqs_queue" "transcription_start_dlq" {
  name                      = "${local.name_prefix}-transcription-start-dlq"
  message_retention_seconds = 1209600
  receive_wait_time_seconds = 20
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "transcription_start" {
  name                       = "${local.name_prefix}-transcription-start"
  visibility_timeout_seconds = 360
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.transcription_start_dlq.arn
    maxReceiveCount     = var.transcription_start_max_receive_count
  })
}

resource "aws_sqs_queue" "webhook_delivery_dlq" {
  name                      = "${local.name_prefix}-webhook-delivery-dlq"
  message_retention_seconds = 1209600
  receive_wait_time_seconds = 20
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "webhook_delivery" {
  name                       = "${local.name_prefix}-webhook-delivery"
  visibility_timeout_seconds = 120
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.webhook_delivery_dlq.arn
    maxReceiveCount     = var.webhook_max_receive_count
  })
}

resource "aws_sqs_queue" "enrichment_dlq" {
  name                      = "${local.name_prefix}-enrichment-dlq"
  message_retention_seconds = 1209600
  receive_wait_time_seconds = 20
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "enrichment" {
  name                       = "${local.name_prefix}-enrichment"
  visibility_timeout_seconds = 360
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.enrichment_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_lambda_event_source_mapping" "transcription_start" {
  event_source_arn        = aws_sqs_queue.transcription_start.arn
  function_name           = aws_lambda_function.handlers["start-transcription"].arn
  enabled                 = local.sqs_workers_enabled
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "webhook_delivery" {
  event_source_arn        = aws_sqs_queue.webhook_delivery.arn
  function_name           = aws_lambda_function.handlers["deliver-webhook"].arn
  enabled                 = local.sqs_workers_enabled
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "enrichment" {
  event_source_arn        = aws_sqs_queue.enrichment.arn
  function_name           = aws_lambda_function.handlers["enrich-transcript"].arn
  enabled                 = local.sqs_workers_enabled
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}

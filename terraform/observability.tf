resource "aws_cloudwatch_log_group" "lambda" {
  for_each = local.lambda_functions

  name              = "/aws/lambda/${local.name_prefix}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = var.enable_cloudwatch_alarms ? local.lambda_functions : {}

  alarm_name          = "${local.name_prefix}-${each.key}-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.handlers[each.key].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "completion_dlq_visible" {
  count = var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-completion-dlq-visible"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.transcribe_completion_dlq.name
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_dlq_visible" {
  for_each = var.enable_cloudwatch_alarms ? {
    transcription_start = aws_sqs_queue.transcription_start_dlq.name
    webhook_delivery    = aws_sqs_queue.webhook_delivery_dlq.name
    enrichment          = aws_sqs_queue.enrichment_dlq.name
  } : {}

  alarm_name          = "${local.name_prefix}-${each.key}-dlq-visible"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = each.value
  }
}
resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.name_prefix}"
  retention_in_days = var.log_retention_days
}

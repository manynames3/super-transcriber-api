resource "aws_lambda_event_source_mapping" "outbox" {
  event_source_arn               = aws_dynamodb_table.main.stream_arn
  function_name                  = aws_lambda_function.handlers["dispatch-outbox"].arn
  starting_position              = "TRIM_HORIZON"
  batch_size                     = 25
  bisect_batch_on_function_error = true
  maximum_retry_attempts         = 3
  function_response_types        = ["ReportBatchItemFailures"]
  filter_criteria {
    filter {
      pattern = jsonencode({ eventName = ["INSERT"], dynamodb = { NewImage = { recordType = { S = ["OUTBOX"] } } } })
    }
  }
  depends_on = [aws_iam_role_policy.lambda]
}

resource "aws_cloudwatch_event_rule" "reconciliation" {
  name                = "${local.name_prefix}-reconciliation"
  schedule_expression = "rate(1 hour)"
  state               = var.enable_job_reconciliation ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "reconciliation" {
  rule      = aws_cloudwatch_event_rule.reconciliation.name
  target_id = "reconcile-jobs"
  arn       = aws_lambda_function.handlers["reconcile-jobs"].arn
}

resource "aws_lambda_permission" "reconciliation" {
  statement_id  = "AllowReconciliationSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handlers["reconcile-jobs"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.reconciliation.arn
}

resource "aws_lambda_function_event_invoke_config" "completion" {
  for_each                     = toset(["completion", "reconcile-jobs"])
  function_name                = aws_lambda_function.handlers[each.key].function_name
  maximum_retry_attempts       = 2
  maximum_event_age_in_seconds = 21600
  destination_config {
    on_failure {
      destination = aws_sqs_queue.transcribe_completion_dlq.arn
    }
  }
}

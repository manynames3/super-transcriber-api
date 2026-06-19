resource "aws_sqs_queue" "transcribe_completion_dlq" {
  name                      = "${local.name_prefix}-transcribe-completion-dlq"
  message_retention_seconds = 1209600
  receive_wait_time_seconds = 20
  sqs_managed_sse_enabled   = true
}

data "aws_iam_policy_document" "transcribe_completion_dlq" {
  statement {
    sid = "AllowEventBridgeSendMessage"

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    actions = [
      "sqs:SendMessage"
    ]

    resources = [
      aws_sqs_queue.transcribe_completion_dlq.arn
    ]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.transcribe_completion.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "transcribe_completion_dlq" {
  queue_url = aws_sqs_queue.transcribe_completion_dlq.id
  policy    = data.aws_iam_policy_document.transcribe_completion_dlq.json
}

resource "aws_cloudwatch_event_rule" "transcribe_completion" {
  name        = "${local.name_prefix}-transcribe-completion"
  description = "Routes Amazon Transcribe completion and failure events to the completion Lambda."

  event_pattern = jsonencode({
    source        = ["aws.transcribe"]
    "detail-type" = ["Transcribe Job State Change"]
    detail = {
      TranscriptionJobStatus = ["COMPLETED", "FAILED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "transcribe_completion" {
  rule      = aws_cloudwatch_event_rule.transcribe_completion.name
  target_id = "completion-lambda"
  arn       = aws_lambda_function.handlers["completion"].arn

  dead_letter_config {
    arn = aws_sqs_queue.transcribe_completion_dlq.arn
  }
}

resource "aws_lambda_permission" "eventbridge_completion" {
  statement_id  = "AllowEventBridgeCompletionInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handlers["completion"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.transcribe_completion.arn
}

mock_provider "aws" {}

override_data {
  target = data.aws_iam_policy_document.lambda_assume_role
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

variables {
  admin_token = "test-admin-token"
}

run "dev_workers_are_disabled_by_default" {
  command = plan

  assert {
    condition = (
      !aws_lambda_event_source_mapping.transcription_start.enabled &&
      !aws_lambda_event_source_mapping.webhook_delivery.enabled &&
      !aws_lambda_event_source_mapping.enrichment.enabled
    )
    error_message = "Dev SQS event-source mappings must be disabled unless explicitly enabled."
  }

  assert {
    condition = alltrue([
      aws_sqs_queue.transcription_start.receive_wait_time_seconds == 20,
      aws_sqs_queue.transcription_start_dlq.receive_wait_time_seconds == 20,
      aws_sqs_queue.webhook_delivery.receive_wait_time_seconds == 20,
      aws_sqs_queue.webhook_delivery_dlq.receive_wait_time_seconds == 20,
      aws_sqs_queue.enrichment.receive_wait_time_seconds == 20,
      aws_sqs_queue.enrichment_dlq.receive_wait_time_seconds == 20,
      aws_sqs_queue.transcribe_completion_dlq.receive_wait_time_seconds == 20
    ])
    error_message = "All SQS queues must use 20-second long polling."
  }
}

run "dev_workers_can_be_explicitly_enabled" {
  command = plan

  variables {
    enable_sqs_workers = true
  }

  assert {
    condition = (
      aws_lambda_event_source_mapping.transcription_start.enabled &&
      aws_lambda_event_source_mapping.webhook_delivery.enabled &&
      aws_lambda_event_source_mapping.enrichment.enabled
    )
    error_message = "The explicit worker flag must enable every SQS event-source mapping."
  }
}

run "production_workers_remain_enabled_by_default" {
  command = plan

  variables {
    environment = "prod"
  }

  assert {
    condition = (
      aws_lambda_event_source_mapping.transcription_start.enabled &&
      aws_lambda_event_source_mapping.webhook_delivery.enabled &&
      aws_lambda_event_source_mapping.enrichment.enabled
    )
    error_message = "Production SQS event-source mappings must remain enabled by default."
  }
}

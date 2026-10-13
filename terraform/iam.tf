data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

locals {
  base_lambda_permissions = {
    health = {
      dynamodb_actions            = []
      dynamodb_resources          = []
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    create-api-key = {
      dynamodb_actions            = ["dynamodb:PutItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = true
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    create-checkout-session = {
      dynamodb_actions            = ["dynamodb:PutItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = true
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    stripe-webhook = {
      dynamodb_actions            = ["dynamodb:UpdateItem", "dynamodb:Query"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = true
      needs_stripe_webhook_secret = true
      bedrock_actions             = []
    }
    claim-checkout-session = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = true
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    get-billing-account = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:Query"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    create-billing-portal = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:Query"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = true
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    configure-webhook = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    presign-upload = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      s3_actions                  = ["s3:PutObject"]
      s3_resources                = ["${aws_s3_bucket.uploads.arn}/customers/*/uploads/*"]
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    create-transcription = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      s3_actions                  = ["s3:GetObject"]
      s3_resources                = ["${aws_s3_bucket.uploads.arn}/customers/*/uploads/*"]
      sqs_actions                 = ["sqs:SendMessage"]
      sqs_resources               = [aws_sqs_queue.transcription_start.arn]
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    start-transcription = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn]
      s3_actions                  = ["s3:GetObject", "s3:PutObject", "s3:GetBucketLocation"]
      s3_resources                = [aws_s3_bucket.uploads.arn, aws_s3_bucket.transcripts.arn, "${aws_s3_bucket.uploads.arn}/customers/*/uploads/*", "${aws_s3_bucket.uploads.arn}/customers/*/processing/*", "${aws_s3_bucket.transcripts.arn}/customers/*/transcripts/*"]
      sqs_actions                 = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
      sqs_resources               = [aws_sqs_queue.transcription_start.arn]
      transcribe_actions          = ["transcribe:GetTranscriptionJob", "transcribe:StartTranscriptionJob"]
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    get-transcription = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:Query"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      s3_actions                  = ["s3:GetObject"]
      s3_resources                = ["${aws_s3_bucket.transcripts.arn}/customers/*/transcripts/*", "${aws_s3_bucket.transcripts.arn}/customers/*/enrichments/*"]
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    list-transcriptions = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:Query"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    delete-transcription = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = []
      sqs_resources               = []
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    completion = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn]
      s3_actions                  = ["s3:GetObject"]
      s3_resources                = ["${aws_s3_bucket.transcripts.arn}/customers/*/transcripts/*"]
      sqs_actions                 = ["sqs:SendMessage"]
      sqs_resources               = [aws_sqs_queue.webhook_delivery.arn, aws_sqs_queue.enrichment.arn]
      transcribe_actions          = ["transcribe:GetTranscriptionJob"]
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    deliver-webhook = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn]
      s3_actions                  = []
      s3_resources                = []
      sqs_actions                 = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
      sqs_resources               = [aws_sqs_queue.webhook_delivery.arn]
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = []
    }
    enrich-transcript = {
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:PutItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn]
      s3_actions                  = ["s3:GetObject", "s3:PutObject"]
      s3_resources                = ["${aws_s3_bucket.transcripts.arn}/customers/*/transcripts/*", "${aws_s3_bucket.transcripts.arn}/customers/*/enrichments/*"]
      sqs_actions                 = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
      sqs_resources               = [aws_sqs_queue.enrichment.arn]
      transcribe_actions          = []
      needs_admin_secret          = false
      needs_stripe_secret         = false
      needs_stripe_webhook_secret = false
      bedrock_actions             = ["bedrock:InvokeModel"]
    }
  }
}

locals {
  authenticated_functions = toset(["create-api-key", "presign-upload", "create-transcription", "get-transcription", "list-transcriptions",
    "delete-transcription", "get-billing-account", "create-billing-portal", "configure-webhook", "download-transcript",
  "manage-api-keys", "purge-transcription", "webhook-deliveries"])
  lambda_permissions = merge(local.base_lambda_permissions, {
    create-api-key = merge(local.base_lambda_permissions.create-api-key, {
      dynamodb_actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"]
      dynamodb_resources = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
    })
    download-transcript = local.base_lambda_permissions.get-transcription
    manage-api-keys = merge(local.base_lambda_permissions.create-api-key, {
      needs_admin_secret = false
      dynamodb_actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem"]
      dynamodb_resources = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
    })
    purge-transcription = merge(local.base_lambda_permissions.delete-transcription, {
      dynamodb_actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:DeleteItem"]
      s3_actions         = ["s3:DeleteObject"]
      s3_resources       = ["${aws_s3_bucket.uploads.arn}/customers/*/uploads/*", "${aws_s3_bucket.uploads.arn}/customers/*/processing/*", "${aws_s3_bucket.transcripts.arn}/customers/*/transcripts/*", "${aws_s3_bucket.transcripts.arn}/customers/*/enrichments/*"]
      transcribe_actions = ["transcribe:DeleteTranscriptionJob", "transcribe:GetTranscriptionJob"]
    })
    webhook-deliveries = merge(local.base_lambda_permissions.configure-webhook, {
      sqs_actions   = ["sqs:SendMessage"]
      sqs_resources = [aws_sqs_queue.webhook_delivery.arn]
    })
    dispatch-outbox = merge(local.base_lambda_permissions.completion, {
      s3_actions         = []
      s3_resources       = []
      transcribe_actions = []
      sqs_resources      = [aws_sqs_queue.transcription_start.arn, aws_sqs_queue.webhook_delivery.arn, aws_sqs_queue.enrichment.arn]
    })
    reconcile-jobs = merge(local.base_lambda_permissions.completion, {
      dynamodb_actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem"]
      dynamodb_resources = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      sqs_resources      = [aws_sqs_queue.transcription_start.arn, aws_sqs_queue.webhook_delivery.arn, aws_sqs_queue.enrichment.arn]
    })
  })
}

resource "aws_iam_role" "lambda" {
  for_each = local.lambda_functions

  name               = "${local.name_prefix}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda" {
  for_each = local.lambda_functions

  statement {
    sid = "WriteOwnLogs"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]

    resources = [
      "${aws_cloudwatch_log_group.lambda[each.key].arn}:*"
    ]
  }

  dynamic "statement" {
    for_each = contains(local.authenticated_functions, each.key) ? [1] : []
    content {
      sid       = "AuthenticateAndRateLimit"
      actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"]
      resources = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/GSI1"]
    }
  }

  dynamic "statement" {
    for_each = each.key == "dispatch-outbox" ? [1] : []
    content {
      sid       = "ReadOutboxStream"
      actions   = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"]
      resources = ["${aws_dynamodb_table.main.arn}/stream/*"]
    }
  }

  dynamic "statement" {
    for_each = each.key == "dispatch-outbox" ? [1] : []
    content {
      sid       = "DiscoverStreams"
      actions   = ["dynamodb:ListStreams"]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = each.key == "completion" || each.key == "reconcile-jobs" ? [1] : []
    content {
      sid       = "ExecutionFailureDestination"
      actions   = ["sqs:SendMessage"]
      resources = [aws_sqs_queue.transcribe_completion_dlq.arn]
    }
  }

  dynamic "statement" {
    for_each = length(local.lambda_permissions[each.key].dynamodb_actions) > 0 ? [1] : []

    content {
      sid       = "UseDynamoDB"
      actions   = local.lambda_permissions[each.key].dynamodb_actions
      resources = local.lambda_permissions[each.key].dynamodb_resources
    }
  }

  dynamic "statement" {
    for_each = length(local.lambda_permissions[each.key].s3_actions) > 0 ? [1] : []

    content {
      sid       = "UseS3"
      actions   = local.lambda_permissions[each.key].s3_actions
      resources = local.lambda_permissions[each.key].s3_resources
    }
  }

  dynamic "statement" {
    for_each = length(local.lambda_permissions[each.key].sqs_actions) > 0 ? [1] : []

    content {
      sid       = "UseSQS"
      actions   = local.lambda_permissions[each.key].sqs_actions
      resources = local.lambda_permissions[each.key].sqs_resources
    }
  }

  dynamic "statement" {
    for_each = length(local.lambda_permissions[each.key].transcribe_actions) > 0 ? [1] : []

    content {
      sid       = "UseTranscribe"
      actions   = local.lambda_permissions[each.key].transcribe_actions
      resources = ["arn:aws:transcribe:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:transcription-job/*"]
    }
  }

  dynamic "statement" {
    for_each = local.lambda_permissions[each.key].needs_admin_secret && local.admin_token_secret_arn != "" ? [1] : []

    content {
      sid       = "ReadAdminSecret"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [local.admin_token_secret_arn]
    }
  }

  dynamic "statement" {
    for_each = local.lambda_permissions[each.key].needs_stripe_secret && var.stripe_secret_arn != "" ? [1] : []

    content {
      sid       = "ReadStripeSecret"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [var.stripe_secret_arn]
    }
  }

  dynamic "statement" {
    for_each = local.lambda_permissions[each.key].needs_stripe_webhook_secret && var.stripe_webhook_secret_arn != "" ? [1] : []

    content {
      sid       = "ReadStripeWebhookSecret"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [var.stripe_webhook_secret_arn]
    }
  }

  dynamic "statement" {
    for_each = length(local.lambda_permissions[each.key].bedrock_actions) > 0 ? [1] : []

    content {
      sid       = "InvokeBedrockModel"
      actions   = local.lambda_permissions[each.key].bedrock_actions
      resources = ["arn:aws:bedrock:${data.aws_region.current.name}::foundation-model/${var.bedrock_model_id}"]
    }
  }
}

resource "aws_iam_role_policy" "lambda" {
  for_each = local.lambda_functions

  name   = "${local.name_prefix}-${each.key}"
  role   = aws_iam_role.lambda[each.key].id
  policy = data.aws_iam_policy_document.lambda[each.key].json
}

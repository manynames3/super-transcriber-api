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
  lambda_permissions = {
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
      dynamodb_actions            = ["dynamodb:TransactWriteItems"]
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
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems"]
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
      dynamodb_actions            = ["dynamodb:Query", "dynamodb:TransactWriteItems"]
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
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"]
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
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
      dynamodb_resources          = [aws_dynamodb_table.main.arn]
      s3_actions                  = []
      s3_resources                = []
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
      dynamodb_actions            = ["dynamodb:Query"]
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
      dynamodb_actions            = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
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
      dynamodb_actions            = ["dynamodb:GetItem"]
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

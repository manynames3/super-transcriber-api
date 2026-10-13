resource "aws_s3_bucket" "uploads" {
  bucket_prefix = "${local.s3_name_prefix}-uploads-"
  force_destroy = var.force_destroy_buckets
}

resource "aws_s3_bucket" "transcripts" {
  bucket_prefix = "${local.s3_name_prefix}-transcripts-"
  force_destroy = var.force_destroy_buckets
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["content-type", "x-amz-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

resource "aws_s3_bucket_public_access_block" "private" {
  for_each = {
    uploads     = aws_s3_bucket.uploads.id
    transcripts = aws_s3_bucket.transcripts.id
  }

  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "private" {
  for_each = {
    uploads     = aws_s3_bucket.uploads.id
    transcripts = aws_s3_bucket.transcripts.id
  }

  bucket = each.value

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "expire-uploaded-audio"
    status = "Enabled"

    filter {
      prefix = ""
    }

    expiration {
      days = var.upload_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id

  rule {
    id     = "expire-transcripts"
    status = "Enabled"

    filter {
      prefix = ""
    }

    expiration {
      days = var.transcript_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "uploads_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.uploads.arn, "${aws_s3_bucket.uploads.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
  statement {
    sid = "AllowTranscribeReadUploads"

    principals {
      type        = "Service"
      identifiers = ["transcribe.amazonaws.com"]
    }

    actions = [
      "s3:GetObject"
    ]

    resources = [
      "${aws_s3_bucket.uploads.arn}/customers/*/uploads/*",
      "${aws_s3_bucket.uploads.arn}/customers/*/processing/*"
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:transcribe:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:transcription-job/*"]
    }
  }

  statement {
    sid = "AllowTranscribeReadUploadBucketLocation"

    principals {
      type        = "Service"
      identifiers = ["transcribe.amazonaws.com"]
    }

    actions = [
      "s3:GetBucketLocation"
    ]

    resources = [
      aws_s3_bucket.uploads.arn
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  policy = data.aws_iam_policy_document.uploads_bucket.json
}

data "aws_iam_policy_document" "transcripts_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.transcripts.arn, "${aws_s3_bucket.transcripts.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
  statement {
    sid = "AllowTranscribeWriteTranscripts"

    principals {
      type        = "Service"
      identifiers = ["transcribe.amazonaws.com"]
    }

    actions = [
      "s3:PutObject"
    ]

    resources = [
      "${aws_s3_bucket.transcripts.arn}/customers/*/transcripts/*"
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:transcribe:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:transcription-job/*"]
    }
  }

  statement {
    sid = "AllowTranscribeReadTranscriptBucketLocation"

    principals {
      type        = "Service"
      identifiers = ["transcribe.amazonaws.com"]
    }

    actions = [
      "s3:GetBucketLocation"
    ]

    resources = [
      aws_s3_bucket.transcripts.arn
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_s3_bucket_policy" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id
  policy = data.aws_iam_policy_document.transcripts_bucket.json
}

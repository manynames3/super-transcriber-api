# 005 Durable Queue Workers

## Status

Accepted.

## Context

Starting Amazon Transcribe inline during `POST /v1/transcriptions` couples customer API latency and reliability to an external AWS service call. Enterprise users need explicit lifecycle states, retryable work, and DLQs.

## Decision

Use SQS-backed workers for side effects after request acceptance. The API writes `QUEUED` and sends a message to `transcription-start`. A worker Lambda transitions the job to `STARTING`, starts Amazon Transcribe, and then transitions to `IN_PROGRESS`. Webhook delivery and optional enrichment also use SQS queues with DLQs.

## Consequences

The API can return `202` quickly and reliably. Failed starts, webhook delivery failures, and enrichment failures are replayable from queues or DLQs. The system adds a few more Lambda functions and IAM roles, but keeps the cost-first serverless model.

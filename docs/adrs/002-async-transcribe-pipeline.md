# 002 Async Transcribe Pipeline

## Status

Accepted

## Context

Transcription can take longer than an API Gateway request timeout. The API must return quickly, preserve job state, and let clients poll status or receive a webhook.

## Decision

Use Amazon Transcribe asynchronous jobs behind a queue. `POST /v1/transcriptions` validates ownership and limits, writes a DynamoDB job record, reserves usage, sends an SQS start message, and returns `202` with `QUEUED`.

The start worker transitions the job to `STARTING`, calls `StartTranscriptionJob` with speaker diarization, writes the Transcribe mapping, and transitions the job to `IN_PROGRESS`. Amazon Transcribe emits a job-state event. EventBridge invokes the completion Lambda for completed and failed jobs. The completion Lambda updates DynamoDB, stores output metadata, decrements active usage counters, and queues webhook delivery or optional enrichment.

## Consequences

Clients poll `GET /v1/transcriptions/{jobId}` or subscribe to webhooks. Start failures are retryable through SQS, and completion handling is protected by an EventBridge target DLQ. Direct synchronous transcription is intentionally excluded.

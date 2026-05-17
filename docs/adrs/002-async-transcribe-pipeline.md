# 002 Async Transcribe Pipeline

## Status

Accepted.

## Context

Transcription can take longer than an API Gateway request timeout. The API must return quickly and let clients poll status.

## Decision

Use Amazon Transcribe asynchronous jobs. `POST /v1/transcriptions` validates ownership and limits, writes a DynamoDB job record plus a Transcribe mapping, starts the Transcribe job with speaker diarization, and returns `202`.

Amazon Transcribe emits a job-state event. EventBridge invokes the completion Lambda for completed and failed jobs. The completion Lambda updates DynamoDB and decrements active usage counters.

## Consequences

Clients poll `GET /v1/transcriptions/{jobId}`. Completion handling is resilient through an EventBridge target DLQ. Direct synchronous transcription is intentionally excluded.

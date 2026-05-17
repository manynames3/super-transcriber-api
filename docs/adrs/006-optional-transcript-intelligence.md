# 006 Optional Transcript Intelligence

## Status

Accepted.

## Context

LLM enrichment can create high-value summaries, action items, topics, and follow-ups, but it adds variable cost and requires Bedrock model access in the deployed AWS account.

## Decision

Keep AI enrichment disabled by default. When `enable_ai_enrichment=true`, the completion handler queues an enrichment job. The enrichment Lambda reads transcript JSON, invokes the configured Bedrock model, writes enrichment JSON to S3, and records enrichment metadata in DynamoDB.

## Consequences

The core transcription API remains cost-first and deterministic by default. Deployments that need AI outputs can enable them without changing the transcription lifecycle or customer-facing API shape.

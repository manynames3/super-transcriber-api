# 003 Cost-First Serverless

## Status

Accepted.

## Context

The target product should be inexpensive to run in development and suitable for private deployment into customer AWS accounts. Fixed monthly services would work against that positioning.

## Decision

Use only request-driven or storage-metered AWS services: API Gateway HTTP API, Lambda, DynamoDB PAY_PER_REQUEST, S3, Amazon Transcribe, EventBridge, SQS DLQ, and CloudWatch Logs. Do not use VPC, NAT Gateway, RDS, provisioned capacity, always-on workers, or frontend hosting.

## Consequences

The system scales from near-zero usage without fixed compute or database capacity. Some advanced features, such as REST API usage plans or relational reporting, are not included. Per-key active job and monthly minute limits are enforced in Lambda with DynamoDB counters.

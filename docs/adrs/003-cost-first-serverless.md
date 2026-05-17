# 003 Cost-First Serverless

## Status

Accepted

## Context

The target product should be inexpensive to run in development and suitable for private deployment into customer AWS accounts. Fixed monthly services would work against that positioning.

## Decision

Use request-driven or storage-metered AWS services for the API backend: API Gateway HTTP API, Lambda, DynamoDB PAY_PER_REQUEST, S3, Amazon Transcribe, EventBridge, SQS, and CloudWatch Logs. Do not use VPC, NAT Gateway, RDS, provisioned capacity, OpenSearch, or always-on workers.

Host the public sales page and static API reference on Cloudflare Pages. This is separate from the AWS API runtime and does not change the customer private-deployment path.

## Consequences

The system scales from near-zero usage without fixed compute or database capacity. Some advanced features, such as REST API usage plans or relational reporting, are not included. Per-key active job and monthly minute limits are enforced in Lambda with DynamoDB counters.

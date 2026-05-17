# ADRs

Architecture decision records for Super Transcriber API.

| ADR | Decision |
| --- | --- |
| [001 API Key Auth](001-api-key-auth.md) | Use hashed API keys with key-id lookup in DynamoDB |
| [002 Async Transcribe Pipeline](002-async-transcribe-pipeline.md) | Use asynchronous Amazon Transcribe jobs and EventBridge completion |
| [003 Cost-First Serverless](003-cost-first-serverless.md) | Use AWS serverless services without fixed monthly infrastructure |
| [004 Single-Table DynamoDB](004-single-table-dynamodb.md) | Store customers, keys, jobs, mappings, and usage in one table |

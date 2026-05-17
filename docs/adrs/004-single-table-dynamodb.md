# 004 Single-Table DynamoDB

## Status

Accepted.

## Context

The API needs customer metadata, API keys, jobs, Transcribe job mappings, and monthly usage counters. DynamoDB on-demand capacity is a strong fit for cost-first serverless workloads.

## Decision

Use one DynamoDB table with `PK` and `SK`, plus GSI1 for API key lookup and GSI2 for recent job listing.

Records:

| Record | PK | SK |
| --- | --- | --- |
| Customer | `CUSTOMER#{customerId}` | `METADATA` |
| API key | `CUSTOMER#{customerId}` | `APIKEY#{keyId}` |
| Job | `CUSTOMER#{customerId}` | `JOB#{jobId}` |
| Transcribe mapping | `TRANSCRIBE#{transcribeJobName}` | `JOB` |
| Usage | `CUSTOMER#{customerId}` | `USAGE#{yyyy-mm}` |

## Consequences

The main API access patterns are direct key lookups or customer-partition queries. Operational analytics that need cross-customer scans should be built later through exports or streams rather than table scans in the request path.

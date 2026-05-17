# 004 Single-Table DynamoDB

## Status

Accepted

## Context

The API needs customer metadata, API keys, billing session state, jobs, Transcribe job mappings, webhooks, optional enrichment metadata, and monthly usage counters. DynamoDB on-demand capacity is a strong fit for cost-first serverless workloads.

## Decision

Use one DynamoDB table with `PK` and `SK`, plus GSI1 for API key lookup and GSI2 for recent job listing.

Records:

| Record | PK | SK |
| --- | --- | --- |
| Customer | `CUSTOMER#{customerId}` | `METADATA` |
| API key | `CUSTOMER#{customerId}` | `APIKEY#{keyId}` |
| Billing session | `BILLING_SESSION#{claimToken}` | `METADATA` |
| Job | `CUSTOMER#{customerId}` | `JOB#{jobId}` |
| Transcribe mapping | `TRANSCRIBE#{transcribeJobName}` | `JOB` |
| Webhook | `CUSTOMER#{customerId}` | `WEBHOOK#default` |
| Enrichment | `CUSTOMER#{customerId}` | `ENRICHMENT#{jobId}` |
| Usage | `CUSTOMER#{customerId}` | `USAGE#{yyyy-mm}` |

## Consequences

The main API access patterns are direct key lookups or customer-partition queries. Operational analytics that need cross-customer scans should be built later through exports or streams rather than table scans in the request path.

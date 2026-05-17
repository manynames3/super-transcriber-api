# 001 API Key Auth

## Status

Accepted.

## Context

The product needs developer-facing API keys without requiring external users to have AWS credentials. Keys must not be stored in plaintext, and lookup must avoid scanning the DynamoDB table.

## Decision

Generate keys in the format `stapi_{keyId}_{secret}`. Store only the SHA-256 hash, the key id, and a display prefix. Look up keys through GSI1 using `APIKEY#{keyId}`, then compare the presented key hash with a constant-time comparison.

The API accepts `x-api-key` and `Authorization: Bearer`. The admin key-creation route is separately protected by `ADMIN_TOKEN`.

## Consequences

Raw API keys are returned once and cannot be recovered. Key rotation is handled by creating a new key and disabling or deleting old records in a future admin operation. API Gateway REST API usage plans are not used because the stack uses HTTP API and needs hashed key storage plus custom per-customer usage counters.

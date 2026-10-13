# 005: Durable Queues And Transactional Event Delivery

## Status

Accepted; extended for the 1.0.0 release.

## Context

Starting Transcribe or sending a callback directly after a database update can lose work when the process fails between those operations. SQS and EventBridge may also redeliver events.

## Decision

Use SQS workers for starts, callbacks, and optional enrichment. Record start and terminal event intent in a DynamoDB outbox in the same transaction as job/capacity/usage changes. Dispatch filtered stream records, retain stable event IDs, use worker leases, and reconcile stale jobs/pending events hourly. Handle EventBridge delivery failures and Lambda execution failures through a completion DLQ.

## Consequences

Accepted work survives interrupted queue delivery. Terminal usage cannot be settled twice. At-least-once callbacks still require customer deduplication. The additional stream dispatcher and bounded recovery calls create small usage charges, with no always-on compute. A paused development worker does not complete jobs until resumed.

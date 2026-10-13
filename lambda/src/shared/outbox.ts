import {
  enqueueEnrichment,
  enqueueTranscriptionStart,
  enqueueWebhookDelivery,
} from "./queue.js";
import { getJob } from "./dynamodb.js";
import { getOutbox, markDispatched, type OutboxRecord } from "./ledger.js";

export async function dispatchOutbox(record: OutboxRecord): Promise<void> {
  const current = await getOutbox(record.id);
  if (!current || current.status !== "PENDING") return;
  const job = await getJob(current.customerId, current.jobId);
  if (!job) {
    await markDispatched(current.id);
    return;
  }
  if (current.kind === "start") await enqueueTranscriptionStart(current);
  if (current.kind === "webhook" && current.eventType)
    await enqueueWebhookDelivery({ ...current, eventType: current.eventType });
  if (current.kind === "enrichment") await enqueueEnrichment(current);
  await markDispatched(current.id);
}

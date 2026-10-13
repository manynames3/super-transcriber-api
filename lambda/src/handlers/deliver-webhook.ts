import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { getJob, getWebhook } from "../shared/dynamodb.js";
import { signWebhookPayload } from "../shared/crypto.js";
import { saveDelivery } from "../shared/ledger.js";
import type { WebhookDeliveryMessage } from "../shared/queue.js";
import { postWebhook } from "../shared/webhook-http.js";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

async function processRecord(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body) as WebhookDeliveryMessage;
  if (
    !message.customerId ||
    !message.jobId ||
    !["transcription.completed", "transcription.failed"].includes(
      message.eventType,
    )
  )
    throw new Error("Invalid webhook message");
  const [webhook, job] = await Promise.all([
    getWebhook(message.customerId),
    getJob(message.customerId, message.jobId),
  ]);
  if (
    !webhook?.enabled ||
    !webhook.events.includes(message.eventType) ||
    !job ||
    job.deleted
  )
    return;
  const id = message.id ?? `${job.jobId}:${message.eventType}`;
  const payload = JSON.stringify({
    id,
    type: message.eventType,
    createdAt: message.createdAt ?? job.updatedAt,
    data: {
      jobId: job.jobId,
      status: job.status,
      fileName: job.fileName,
      durationSeconds: job.durationSeconds,
      wordCount: job.wordCount,
      failureReason: job.failureReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
  const timestamp = new Date().toISOString();
  try {
    const status = await postWebhook(webhook.url, payload, {
      "content-type": "application/json",
      "x-super-transcriber-event": message.eventType,
      "x-super-transcriber-signature": `t=${timestamp},v1=${signWebhookPayload(webhook.signingSecret, payload, timestamp)}`,
      "x-super-transcriber-delivery": id,
    });
    if (status < 200 || status >= 300)
      throw new Error(`Webhook returned HTTP ${status}`);
    await saveDelivery(message.customerId, message.jobId, id, {
      status: "DELIVERED",
    });
  } catch (error) {
    await saveDelivery(message.customerId, message.jobId, id, {
      status: "FAILED",
      error: error instanceof Error ? error.message : "Delivery failed",
    });
    throw error;
  }
}

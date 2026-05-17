import { randomUUID } from "node:crypto";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { getJob, getWebhook } from "../shared/dynamodb.js";
import { signWebhookPayload } from "../shared/crypto.js";
import { logError, logInfo, logWarn } from "../shared/response.js";
import type { WebhookDeliveryMessage } from "../shared/queue.js";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      failures.push({ itemIdentifier: record.messageId });
      logError("webhook_delivery_failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  return { batchItemFailures: failures };
}

async function processRecord(record: SQSRecord): Promise<void> {
  const message = parseMessage(record.body);
  const webhook = await getWebhook(message.customerId);
  if (!webhook || !webhook.enabled || !webhook.events.includes(message.eventType)) {
    logInfo("webhook_delivery_skipped", {
      customerId: message.customerId,
      jobId: message.jobId,
      eventType: message.eventType
    });
    return;
  }

  const job = await getJob(message.customerId, message.jobId);
  if (!job) {
    logWarn("webhook_delivery_job_missing", {
      customerId: message.customerId,
      jobId: message.jobId,
      eventType: message.eventType
    });
    return;
  }

  const timestamp = new Date().toISOString();
  const payload = JSON.stringify({
    id: randomUUID(),
    type: message.eventType,
    createdAt: timestamp,
    data: {
      jobId: job.jobId,
      status: job.status,
      fileName: job.fileName,
      durationSeconds: job.durationSeconds,
      wordCount: job.wordCount,
      failureReason: job.failureReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    }
  });
  const signature = signWebhookPayload(webhook.signingSecret, payload, timestamp);
  const response = await fetch(webhook.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-super-transcriber-event": message.eventType,
      "x-super-transcriber-signature": `t=${timestamp},v1=${signature}`,
      "x-super-transcriber-delivery": record.messageId
    },
    body: payload,
    signal: AbortSignal.timeout(Number(process.env.WEBHOOK_TIMEOUT_MS ?? "10000"))
  });

  if (!response.ok) {
    throw new Error(`Webhook endpoint returned ${response.status}`);
  }

  logInfo("webhook_delivered", {
    customerId: message.customerId,
    jobId: message.jobId,
    eventType: message.eventType
  });
}

function parseMessage(body: string): WebhookDeliveryMessage {
  const parsed = JSON.parse(body) as Partial<WebhookDeliveryMessage>;
  if (
    !parsed.customerId ||
    !parsed.jobId ||
    (parsed.eventType !== "transcription.completed" && parsed.eventType !== "transcription.failed")
  ) {
    throw new Error("Invalid webhook delivery message");
  }
  return {
    customerId: parsed.customerId,
    jobId: parsed.jobId,
    eventType: parsed.eventType
  };
}

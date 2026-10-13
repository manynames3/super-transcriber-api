import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});

export interface TranscriptionStartMessage {
  customerId: string;
  jobId: string;
}

export interface WebhookDeliveryMessage {
  customerId: string;
  jobId: string;
  eventType: "transcription.completed" | "transcription.failed";
  id?: string;
  createdAt?: string;
}

export interface EnrichmentMessage {
  customerId: string;
  jobId: string;
}

export async function enqueueTranscriptionStart(message: TranscriptionStartMessage): Promise<void> {
  await sendJson(requireEnv("TRANSCRIPTION_START_QUEUE_URL"), message);
}

export async function enqueueWebhookDelivery(message: WebhookDeliveryMessage): Promise<void> {
  const queueUrl = process.env.WEBHOOK_DELIVERY_QUEUE_URL;
  if (!queueUrl) {
    throw new Error("WEBHOOK_DELIVERY_QUEUE_URL is required");
  }
  await sendJson(queueUrl, message);
}

export async function enqueueEnrichment(message: EnrichmentMessage): Promise<void> {
  const queueUrl = process.env.ENRICHMENT_QUEUE_URL;
  if (!queueUrl || process.env.AI_ENRICHMENT_ENABLED !== "true") {
    return;
  }
  await sendJson(queueUrl, message);
}

async function sendJson(queueUrl: string, message: unknown): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message)
    })
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

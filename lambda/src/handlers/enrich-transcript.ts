import { InvokeModelCommand, BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { customerPk, getJob, nowIso, putEnrichmentRecord } from "../shared/dynamodb.js";
import { logError, logInfo, logWarn } from "../shared/response.js";
import { summarizeTranscript } from "../shared/transcript-format.js";
import type { EnrichmentMessage } from "../shared/queue.js";

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchResponse["batchItemFailures"] = [];

  logInfo("sqs_worker_batch_started", {
    worker: "enrich-transcript",
    queueArn: event.Records[0]?.eventSourceARN,
    batchSize: event.Records.length,
    queueReceiveWaitTimeSeconds: 20,
    idleBackoff: "managed-by-lambda-event-source-mapping"
  });

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      failures.push({ itemIdentifier: record.messageId });
      logError("enrichment_failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  return { batchItemFailures: failures };
}

async function processRecord(record: SQSRecord): Promise<void> {
  if (process.env.AI_ENRICHMENT_ENABLED !== "true") {
    return;
  }

  const message = parseMessage(record.body);
  const job = await getJob(message.customerId, message.jobId);
  if (!job || job.deleted || job.status !== "COMPLETED") {
    logWarn("enrichment_job_not_ready", {
      customerId: message.customerId,
      jobId: message.jobId
    });
    return;
  }

  const transcriptBucket = requireEnv("TRANSCRIPT_BUCKET");
  const payload = await readJsonObject(transcriptBucket, job.transcriptJsonS3Key);
  const transcript = summarizeTranscript(payload).transcriptText;
  const enrichment = await enrichWithBedrock(transcript);
  const now = nowIso();
  const s3Key = `customers/${job.customerId}/enrichments/${job.jobId}.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: transcriptBucket,
      Key: s3Key,
      ContentType: "application/json",
      Body: JSON.stringify(
        {
          jobId: job.jobId,
          customerId: job.customerId,
          createdAt: now,
          enrichment
        },
        null,
        2
      )
    })
  );

  await putEnrichmentRecord({
    PK: customerPk(job.customerId),
    SK: `ENRICHMENT#${job.jobId}`,
    recordType: "ENRICHMENT",
    customerId: job.customerId,
    jobId: job.jobId,
    status: "COMPLETED",
    s3Key,
    failureReason: null,
    createdAt: now,
    updatedAt: now
  });

  logInfo("enrichment_completed", {
    customerId: job.customerId,
    jobId: job.jobId
  });
}

async function enrichWithBedrock(transcript: string): Promise<unknown> {
  const modelId = requireEnv("BEDROCK_MODEL_ID");
  const prompt = [
    "You are an enterprise transcription assistant.",
    "Return strict JSON with keys: summary, actionItems, topics, sentiment, risks, followUps.",
    "Do not include markdown.",
    "",
    transcript.slice(0, Number(process.env.AI_ENRICHMENT_MAX_CHARS ?? "12000"))
  ].join("\n");

  const result = await bedrock.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: Number(process.env.AI_ENRICHMENT_MAX_TOKENS ?? "1200"),
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }]
          }
        ]
      })
    })
  );

  const decoded = JSON.parse(new TextDecoder().decode(result.body)) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = decoded.content?.find((part) => part.type === "text")?.text ?? "{}";
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text };
  }
}

async function readJsonObject(bucket: string, key: string): Promise<unknown> {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  const text = await result.Body?.transformToString();
  return text ? JSON.parse(text) : {};
}

function parseMessage(body: string): EnrichmentMessage {
  const parsed = JSON.parse(body) as Partial<EnrichmentMessage>;
  if (!parsed.customerId || !parsed.jobId) {
    throw new Error("Invalid enrichment message");
  }
  return {
    customerId: parsed.customerId,
    jobId: parsed.jobId
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EventBridgeEvent } from "aws-lambda";
import {
  closeActiveUsage,
  getJob,
  getTranscribeMapping,
  markJobCompleted,
  markJobFailed
} from "../shared/dynamodb.js";
import { enqueueEnrichment, enqueueWebhookDelivery } from "../shared/queue.js";
import { logInfo, logWarn } from "../shared/response.js";
import { getTranscribeJobStatus } from "../shared/transcribe.js";
import { summarizeTranscript } from "../shared/transcript-format.js";

interface TranscribeStateChangeDetail {
  TranscriptionJobName?: string;
  TranscriptionJobStatus?: "COMPLETED" | "FAILED";
  FailureReason?: string;
}

const s3 = new S3Client({});

export async function handler(event: EventBridgeEvent<"Transcribe Job State Change", TranscribeStateChangeDetail>): Promise<void> {
  const transcribeJobName = event.detail.TranscriptionJobName;
  if (!transcribeJobName) {
    logWarn("completion_event_missing_job_name", { eventId: event.id });
    return;
  }

  const mapping = await getTranscribeMapping(transcribeJobName);
  if (!mapping) {
    logWarn("completion_mapping_missing", { eventId: event.id, transcribeJobName });
    return;
  }

  const job = await getJob(mapping.customerId, mapping.jobId);
  if (!job) {
    logWarn("completion_job_missing", {
      eventId: event.id,
      customerId: mapping.customerId,
      jobId: mapping.jobId,
      transcribeJobName
    });
    return;
  }

  const status = event.detail.TranscriptionJobStatus ?? (await getTranscribeJobStatus(transcribeJobName)).status;

  if (status === "COMPLETED") {
    const transcriptBucket = process.env.TRANSCRIPT_BUCKET;
    if (!transcriptBucket) {
      throw new Error("TRANSCRIPT_BUCKET is required");
    }

    const payload = await readJsonObject(transcriptBucket, job.transcriptJsonS3Key);
    const summary = summarizeTranscript(payload);
    const transitioned = await markJobCompleted(mapping.customerId, mapping.jobId, summary.wordCount);
    if (transitioned) {
      await closeActiveUsage(mapping.customerId, job.usageMonth, true);
      await enqueueWebhookDelivery({
        customerId: mapping.customerId,
        jobId: mapping.jobId,
        eventType: "transcription.completed"
      });
      await enqueueEnrichment({
        customerId: mapping.customerId,
        jobId: mapping.jobId
      });
    }
    logInfo("transcription_completed", {
      eventId: event.id,
      customerId: mapping.customerId,
      jobId: mapping.jobId,
      transcribeJobName
    });
    return;
  }

  if (status === "FAILED") {
    const fallbackStatus = await getTranscribeJobStatus(transcribeJobName);
    const reason = event.detail.FailureReason ?? fallbackStatus.failureReason ?? "Amazon Transcribe reported failure";
    const transitioned = await markJobFailed(mapping.customerId, mapping.jobId, reason);
    if (transitioned) {
      await closeActiveUsage(mapping.customerId, job.usageMonth, false);
      await enqueueWebhookDelivery({
        customerId: mapping.customerId,
        jobId: mapping.jobId,
        eventType: "transcription.failed"
      });
    }
    logInfo("transcription_failed", {
      eventId: event.id,
      customerId: mapping.customerId,
      jobId: mapping.jobId,
      transcribeJobName
    });
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

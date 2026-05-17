import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EventBridgeEvent } from "aws-lambda";
import {
  closeActiveUsage,
  getJob,
  getTranscribeMapping,
  markJobCompleted,
  markJobFailed
} from "../shared/dynamodb.js";
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
    await markJobCompleted(mapping.customerId, mapping.jobId, summary.wordCount);
    await closeActiveUsage(mapping.customerId, job.usageMonth, true);
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
    await markJobFailed(mapping.customerId, mapping.jobId, reason);
    await closeActiveUsage(mapping.customerId, job.usageMonth, false);
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

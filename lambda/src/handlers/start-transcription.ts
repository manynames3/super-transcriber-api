import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import {
  getJob,
  markJobFailed,
  markJobInProgress,
  markJobStarting,
  releaseUsageReservation
} from "../shared/dynamodb.js";
import { logError, logInfo, logWarn } from "../shared/response.js";
import { startTranscribeJob } from "../shared/transcribe.js";

interface StartMessage {
  customerId: string;
  jobId: string;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchResponse["batchItemFailures"] = [];

  logInfo("sqs_worker_batch_started", {
    worker: "start-transcription",
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
      logError("transcription_start_worker_failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  return { batchItemFailures: failures };
}

async function processRecord(record: SQSRecord): Promise<void> {
  const message = parseMessage(record.body);
  const job = await getJob(message.customerId, message.jobId);
  if (!job || job.deleted) {
    logWarn("transcription_start_job_missing", {
      customerId: message.customerId,
      jobId: message.jobId
    });
    return;
  }

  if (job.status !== "QUEUED" && job.status !== "STARTING") {
    logInfo("transcription_start_skipped", {
      customerId: job.customerId,
      jobId: job.jobId,
      status: job.status
    });
    return;
  }

  const locked = await markJobStarting(job.customerId, job.jobId);
  if (!locked) {
    return;
  }

  try {
    await startTranscribeJob({
      customerId: job.customerId,
      jobId: job.jobId,
      transcribeJobName: job.transcribeJobName,
      s3Key: job.s3Key,
      fileName: job.fileName,
      speakerCount: job.speakerCount ?? undefined,
      transcriptJsonS3Key: job.transcriptJsonS3Key
    });
    await markJobInProgress(job.customerId, job.jobId);
    logInfo("transcription_start_worker_started", {
      customerId: job.customerId,
      jobId: job.jobId,
      transcribeJobName: job.transcribeJobName
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ConflictException") {
      await markJobInProgress(job.customerId, job.jobId);
      return;
    }

    if (receiveCount(record) >= maxReceiveCount()) {
      const reason = error instanceof Error ? error.message : "Amazon Transcribe failed to start";
      const transitioned = await markJobFailed(job.customerId, job.jobId, reason);
      if (transitioned) {
        await releaseUsageReservation(job.customerId, job.usageMonth, job.reservedDurationSeconds);
      }
      logError("transcription_start_worker_exhausted", {
        customerId: job.customerId,
        jobId: job.jobId,
        transcribeJobName: job.transcribeJobName
      });
      return;
    }

    throw error;
  }
}

function parseMessage(body: string): StartMessage {
  const parsed = JSON.parse(body) as Partial<StartMessage>;
  if (!parsed.customerId || !parsed.jobId) {
    throw new Error("Invalid transcription start message");
  }
  return {
    customerId: parsed.customerId,
    jobId: parsed.jobId
  };
}

function receiveCount(record: SQSRecord): number {
  return Number(record.attributes.ApproximateReceiveCount ?? "1");
}

function maxReceiveCount(): number {
  return Number(process.env.TRANSCRIPTION_START_MAX_RECEIVE_COUNT ?? "3");
}

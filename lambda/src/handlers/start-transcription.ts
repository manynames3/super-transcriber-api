import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import {
  getJob,
  markJobInProgress,
  markJobStarting,
} from "../shared/dynamodb.js";
import { ApiError } from "../shared/errors.js";
import { finishJob, reserveVerifiedUsage } from "../shared/ledger.js";
import { verifyAudio } from "../shared/media.js";
import { logError } from "../shared/response.js";
import { startTranscribeJob } from "../shared/transcribe.js";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      logError("start_worker_failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

async function processRecord(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body) as {
    customerId: string;
    jobId: string;
  };
  if (!message.customerId || !message.jobId)
    throw new Error("Invalid start message");
  let job = await getJob(message.customerId, message.jobId);
  if (!job || !["QUEUED", "STARTING"].includes(job.status)) return;
  if (!(await markJobStarting(job.customerId, job.jobId))) return;
  try {
    if (job.meteringVersion === 2 && !job.usageReserved) {
      const duration = await verifyAudio(job);
      job = await reserveVerifiedUsage(job, duration);
    }
    await startTranscribeJob({
      ...job,
      s3Key: job.processingS3Key ?? job.s3Key,
      speakerCount: job.speakerCount ?? undefined,
    });
    await markJobInProgress(job.customerId, job.jobId);
  } catch (error) {
    if (error instanceof Error && error.name === "ConflictException") {
      await markJobInProgress(job.customerId, job.jobId);
      return;
    }
    const permanent =
      error instanceof ApiError ||
      (error instanceof Error &&
        [
          "PreconditionFailed",
          "NoSuchKey",
          "UnsupportedFileTypeError",
          "CouldNotDetermineFileTypeError",
        ].includes(error.name));
    const exhausted =
      Number(record.attributes.ApproximateReceiveCount ?? "1") >=
      Number(process.env.TRANSCRIPTION_START_MAX_RECEIVE_COUNT ?? "3");
    if (permanent || exhausted) {
      await finishJob(job, "FAILED", {
        failureReason:
          error instanceof ApiError
            ? error.message
            : permanent
              ? "Uploaded audio could not be validated"
              : "Transcription could not start after retries",
      });
      return;
    }
    throw error;
  }
}

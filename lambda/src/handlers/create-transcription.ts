import { randomUUID } from "node:crypto";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import {
  customerPk,
  jobSk,
  markJobFailed,
  nowIso,
  putJobAndMapping,
  releaseUsageReservation,
  reserveUsageCapacity,
  type JobRecord,
  type TranscribeMappingRecord
} from "../shared/dynamodb.js";
import { badRequest, internalError, notImplemented, upstreamFailure } from "../shared/errors.js";
import { errorResponse, jsonResponse, logError, logInfo } from "../shared/response.js";
import { startTranscribeJob } from "../shared/transcribe.js";
import {
  assertFileSize,
  monthKey,
  parseJsonBody,
  reservedDurationSeconds,
  validateCreateTranscriptionRequest
} from "../shared/validation.js";

const s3 = new S3Client({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  let reservation:
    | {
        customerId: string;
        usageMonth: string;
        reservedSeconds: number;
        jobId: string;
      }
    | undefined;

  try {
    const auth = await authenticate(event);
    const input = validateCreateTranscriptionRequest(parseJsonBody(event.body), auth.limits);

    if (input.sourceUrl) {
      throw notImplemented("sourceUrl transcription is not implemented in v1; upload to S3 with a presigned URL first");
    }

    if (!input.s3Key) {
      throw badRequest("s3Key is required", "INVALID_SOURCE");
    }

    assertOwnedS3Key(auth.customerId, input.s3Key);
    await assertObjectIsUsable(input.s3Key, auth.limits.maxFileSizeBytes);

    const jobId = randomUUID();
    const usageMonth = monthKey();
    const reservedSeconds = reservedDurationSeconds(input.durationSeconds, auth.limits.maxDurationSeconds);
    await reserveUsageCapacity(auth.customerId, usageMonth, reservedSeconds, auth.limits);
    reservation = { customerId: auth.customerId, usageMonth, reservedSeconds, jobId };

    const now = nowIso();
    const transcribeJobName = `st-${auth.customerId}-${jobId}`;
    const transcriptJsonS3Key = `customers/${auth.customerId}/transcripts/${jobId}.json`;
    const job: JobRecord = {
      PK: customerPk(auth.customerId),
      SK: jobSk(jobId),
      GSI2PK: `JOBS#${auth.customerId}`,
      GSI2SK: `${now}#${jobId}`,
      recordType: "JOB",
      jobId,
      customerId: auth.customerId,
      status: "IN_PROGRESS",
      s3Key: input.s3Key,
      fileName: input.fileName,
      durationSeconds: input.durationSeconds ?? null,
      reservedDurationSeconds: reservedSeconds,
      wordCount: 0,
      failureReason: null,
      deleted: false,
      transcribeJobName,
      transcriptJsonS3Key,
      usageMonth,
      createdAt: now,
      updatedAt: now
    };

    const mapping: TranscribeMappingRecord = {
      PK: `TRANSCRIBE#${transcribeJobName}`,
      SK: "JOB",
      recordType: "TRANSCRIBE_JOB",
      customerId: auth.customerId,
      jobId,
      transcribeJobName,
      createdAt: now,
      updatedAt: now
    };

    await putJobAndMapping(job, mapping);

    try {
      await startTranscribeJob({
        customerId: auth.customerId,
        jobId,
        transcribeJobName,
        s3Key: input.s3Key,
        fileName: input.fileName,
        speakerCount: input.speakerCount,
        transcriptJsonS3Key
      });
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : "Failed to start Amazon Transcribe job";
      await markJobFailed(auth.customerId, jobId, failureReason);
      await releaseUsageReservation(auth.customerId, usageMonth, reservedSeconds);
      reservation = undefined;
      logError("transcribe_start_failed", {
        requestId: event.requestContext.requestId,
        customerId: auth.customerId,
        route: "POST /v1/transcriptions",
        jobId
      });
      throw upstreamFailure("Amazon Transcribe could not start the job");
    }

    logInfo("transcription_started", {
      requestId: event.requestContext.requestId,
      customerId: auth.customerId,
      route: "POST /v1/transcriptions",
      jobId
    });

    return jsonResponse(202, {
      jobId,
      status: "IN_PROGRESS"
    });
  } catch (error) {
    if (reservation) {
      await releaseUsageReservation(reservation.customerId, reservation.usageMonth, reservation.reservedSeconds);
    }
    return errorResponse(error);
  }
}

function assertOwnedS3Key(customerId: string, s3Key: string): void {
  const expectedPrefix = `customers/${customerId}/uploads/`;
  if (!s3Key.startsWith(expectedPrefix) || s3Key.includes("..")) {
    throw badRequest("s3Key is not owned by this API key", "INVALID_S3_KEY");
  }
}

async function assertObjectIsUsable(s3Key: string, maxFileSizeBytes: number): Promise<void> {
  const uploadBucket = process.env.UPLOAD_BUCKET;
  if (!uploadBucket) {
    throw internalError("Upload bucket is not configured");
  }

  const result = await s3.send(
    new HeadObjectCommand({
      Bucket: uploadBucket,
      Key: s3Key
    })
  );

  if (!result.ContentLength) {
    throw badRequest("Uploaded object is empty or missing a Content-Length", "INVALID_UPLOAD");
  }

  assertFileSize(result.ContentLength, maxFileSizeBytes);
}

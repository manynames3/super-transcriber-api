import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import {
  getJob,
  markJobFailed,
  markJobQueued,
  releaseUsageReservation,
  reserveUsageCapacity
} from "../shared/dynamodb.js";
import { badRequest, conflict, internalError, notFound, notImplemented } from "../shared/errors.js";
import { enqueueTranscriptionStart } from "../shared/queue.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";
import {
  assertFileSize,
  monthKey,
  parseOwnedUploadS3Key,
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
    const body = parseJsonBody<Record<string, unknown>>(event.body);
    if (typeof body.sourceUrl === "string" && body.sourceUrl.trim() && !body.s3Key) {
      throw notImplemented("sourceUrl transcription is not implemented in v1; upload to S3 with a presigned URL first");
    }

    const input = validateCreateTranscriptionRequest(body, auth.limits);

    if (input.sourceUrl) {
      throw notImplemented("sourceUrl transcription is not implemented in v1; upload to S3 with a presigned URL first");
    }

    const s3Key = input.s3Key ?? "";
    const upload = parseOwnedUploadS3Key(auth.customerId, s3Key);
    if (input.fileName && input.fileName !== upload.fileName) {
      throw badRequest("fileName must match the file name in s3Key", "INVALID_FILE_NAME");
    }
    const fileName = input.fileName ?? upload.fileName;
    await assertObjectIsUsable(s3Key, auth.limits.maxFileSizeBytes);

    const existingJob = await getJob(auth.customerId, upload.jobId);
    if (!existingJob || existingJob.deleted) {
      throw notFound("Upload reservation not found");
    }
    if (existingJob.status !== "PENDING_UPLOAD") {
      throw conflict(`Transcription job is already ${existingJob.status}`, "JOB_NOT_PENDING_UPLOAD");
    }

    const jobId = upload.jobId;
    const usageMonth = monthKey();
    const reservedSeconds = reservedDurationSeconds(input.durationSeconds, auth.limits.maxDurationSeconds);
    await reserveUsageCapacity(auth.customerId, usageMonth, reservedSeconds, auth.limits);
    reservation = { customerId: auth.customerId, usageMonth, reservedSeconds, jobId };

    await markJobQueued(auth.customerId, jobId, {
      durationSeconds: input.durationSeconds ?? null,
      reservedDurationSeconds: reservedSeconds,
      speakerCount: input.speakerCount ?? null,
      usageMonth
    });

    try {
      await enqueueTranscriptionStart({
        customerId: auth.customerId,
        jobId
      });
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : "Failed to queue transcription job";
      await markJobFailed(auth.customerId, jobId, failureReason);
      await releaseUsageReservation(auth.customerId, usageMonth, reservedSeconds);
      reservation = undefined;
      throw error;
    }

    logInfo("transcription_queued", {
      requestId: event.requestContext.requestId,
      customerId: auth.customerId,
      route: "POST /v1/transcriptions",
      jobId
    });

    return jsonResponse(202, {
      jobId,
      status: "QUEUED",
      pollUrl: `/v1/transcriptions/${jobId}`,
      links: {
        self: `/v1/transcriptions/${jobId}`
      }
    });
  } catch (error) {
    if (reservation) {
      await releaseUsageReservation(reservation.customerId, reservation.usageMonth, reservation.reservedSeconds);
    }
    if (error instanceof Error && (error.name === "TransactionCanceledException" || error.name === "ConditionalCheckFailedException")) {
      return errorResponse(conflict("Transcription job is not ready to be queued", "JOB_NOT_PENDING_UPLOAD"));
    }
    return errorResponse(error);
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

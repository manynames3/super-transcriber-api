import { createHash } from "node:crypto";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { getJob } from "../shared/dynamodb.js";
import { badRequest, notFound, notImplemented } from "../shared/errors.js";
import { queueJob } from "../shared/ledger.js";
import { errorResponse, jsonResponse } from "../shared/response.js";
import {
  assertFileSize,
  parseOwnedUploadS3Key,
  parseJsonBody,
  validateCreateTranscriptionRequest,
} from "../shared/validation.js";

const s3 = new S3Client({});

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event);
    const input = validateCreateTranscriptionRequest(
      parseJsonBody(event.body),
      auth.limits,
    );
    if (input.sourceUrl)
      throw notImplemented(
        "Upload through /v1/uploads/presign; sourceUrl ingestion is not implemented",
      );
    const s3Key = input.s3Key!;
    const upload = parseOwnedUploadS3Key(auth.customerId, s3Key);
    if (input.fileName !== upload.fileName)
      throw badRequest(
        "fileName must match the uploaded file",
        "INVALID_FILE_NAME",
      );
    const job = await getJob(auth.customerId, upload.jobId);
    if (!job || job.deleted) throw notFound("Upload reservation not found");
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          s3Key,
          speakerCount: input.speakerCount ?? 2,
          languageCode:
            input.languageCode ?? process.env.DEFAULT_LANGUAGE_CODE ?? "en-US",
        }),
      )
      .digest("hex");
    let etag = job.uploadETag;
    if (job.status === "PENDING_UPLOAD") {
      const object = await s3.send(
        new HeadObjectCommand({
          Bucket: process.env.UPLOAD_BUCKET,
          Key: s3Key,
        }),
      );
      if (!object.ContentLength || !object.ETag)
        throw badRequest("Audio upload is empty", "INVALID_UPLOAD");
      assertFileSize(object.ContentLength, auth.limits.maxFileSizeBytes);
      if (job.fileSizeBytes && object.ContentLength !== job.fileSizeBytes)
        throw badRequest(
          "Uploaded size differs from the reserved size",
          "INVALID_UPLOAD",
        );
      etag = object.ETag;
    }
    const queued = await queueJob(job, auth.limits, requestHash, {
      speakerCount: input.speakerCount,
      languageCode:
        input.languageCode ?? process.env.DEFAULT_LANGUAGE_CODE ?? "en-US",
      uploadETag: etag ?? "",
      keyId: auth.keyId,
    });
    return jsonResponse(202, {
      jobId: queued.jobId,
      status: queued.status,
      pollUrl: `/v1/transcriptions/${queued.jobId}`,
      links: { self: `/v1/transcriptions/${queued.jobId}` },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotFound" || error.name === "NoSuchKey")
    )
      return errorResponse(
        notFound("Upload the audio before starting transcription"),
      );
    return errorResponse(error);
  }
}

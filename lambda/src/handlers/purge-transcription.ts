import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DeleteTranscriptionJobCommand,
  TranscribeClient,
} from "@aws-sdk/client-transcribe";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { client, getJob, tableName } from "../shared/dynamodb.js";
import { conflict } from "../shared/errors.js";
import { getTranscribeJobStatus } from "../shared/transcribe.js";
import { emptyResponse, errorResponse } from "../shared/response.js";

const s3 = new S3Client({});
const transcribe = new TranscribeClient({});

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event, {
      allowBillingBlocked: true,
      scope: "transcriptions:delete",
    });
    const job = await getJob(
      auth.customerId,
      event.pathParameters?.jobId ?? "",
    );
    if (!job) return emptyResponse();
    if (!["PENDING_UPLOAD", "COMPLETED", "FAILED"].includes(job.status))
      throw conflict(
        "Wait for the active job to finish before purging",
        "JOB_ACTIVE",
      );
    const expires = Date.parse(
      job.uploadExpiresAt ??
        new Date(
          Date.parse(job.createdAt) +
            Number(process.env.UPLOAD_PRESIGN_SECONDS ?? 900) * 1000,
        ).toISOString(),
    );
    if (Date.now() < expires)
      throw conflict(
        "Upload URL must expire before permanent deletion",
        "UPLOAD_URL_STILL_ACTIVE",
      );
    try {
      const state = await getTranscribeJobStatus(job.transcribeJobName);
      if (state.status === "IN_PROGRESS" || state.status === "QUEUED")
        throw conflict(
          "Transcribe is still processing; wait before purging",
          "JOB_ACTIVE",
        );
    } catch (error) {
      if (!(
        error instanceof Error &&
        ["BadRequestException", "NotFoundException"].includes(error.name) &&
        /not found|couldn't be found|doesn't exist|not exist/i.test(
          error.message,
        )
      ))
        throw error;
    }
    const objects = [
      { bucket: process.env.UPLOAD_BUCKET, key: job.s3Key },
      { bucket: process.env.UPLOAD_BUCKET, key: job.processingS3Key },
      { bucket: process.env.TRANSCRIPT_BUCKET, key: job.transcriptJsonS3Key },
      {
        bucket: process.env.TRANSCRIPT_BUCKET,
        key: `customers/${job.customerId}/enrichments/${job.jobId}.json`,
      },
    ];
    for (const object of objects)
      if (object.key)
        await s3.send(
          new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }),
        );
    try {
      await transcribe.send(
        new DeleteTranscriptionJobCommand({
          TranscriptionJobName: job.transcribeJobName,
        }),
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        ["BadRequestException", "NotFoundException"].includes(error.name) &&
        /not found|couldn't be found|doesn't exist|not exist/i.test(
          error.message,
        )
      ))
        throw error;
    }
    const keys = [
      { PK: job.PK, SK: job.SK },
      { PK: `TRANSCRIBE#${job.transcribeJobName}`, SK: "JOB" },
      { PK: job.PK, SK: `ENRICHMENT#${job.jobId}` },
      ...["transcription.completed", "transcription.failed"].map((type) => ({
        PK: job.PK,
        SK: `DELIVERY#${job.jobId}#${job.jobId}:${type}`,
      })),
      ...[
        "start",
        "enrichment",
        "transcription.completed",
        "transcription.failed",
      ].map((type) => ({ PK: `OUTBOX#${job.jobId}:${type}`, SK: "EVENT" })),
    ];
    await client.send(
      new TransactWriteCommand({
        TransactItems: keys.map((Key) => ({
          Delete: { TableName: tableName, Key },
        })),
      }),
    );
    return emptyResponse();
  } catch (error) {
    return errorResponse(error);
  }
}

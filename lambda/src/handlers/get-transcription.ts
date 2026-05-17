import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { requireVisibleJob } from "../shared/dynamodb.js";
import { internalError } from "../shared/errors.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";
import { summarizeTranscript } from "../shared/transcript-format.js";

const s3 = new S3Client({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event);
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      throw internalError("Missing jobId route parameter");
    }

    const job = await requireVisibleJob(auth.customerId, jobId);
    const body: Record<string, unknown> = {
      jobId: job.jobId,
      status: job.status,
      fileName: job.fileName,
      durationSeconds: job.durationSeconds,
      wordCount: job.wordCount,
      failureReason: job.failureReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };

    if (job.status === "COMPLETED") {
      const transcriptBucket = process.env.TRANSCRIPT_BUCKET;
      if (!transcriptBucket) {
        throw internalError("Transcript bucket is not configured");
      }

      const payload = await readJsonObject(transcriptBucket, job.transcriptJsonS3Key);
      const summary = summarizeTranscript(payload);
      body.transcriptText = summary.transcriptText;
      body.wordCount = summary.wordCount;
      body.transcriptJsonUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: transcriptBucket,
          Key: job.transcriptJsonS3Key
        }),
        { expiresIn: Number(process.env.TRANSCRIPT_PRESIGN_SECONDS ?? "900") }
      );
    }

    logInfo("transcription_read", {
      requestId: event.requestContext.requestId,
      customerId: auth.customerId,
      route: "GET /v1/transcriptions/{jobId}",
      jobId
    });

    return jsonResponse(200, body);
  } catch (error) {
    return errorResponse(error);
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

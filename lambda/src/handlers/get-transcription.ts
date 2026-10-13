import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { getEnrichmentRecord, requireVisibleJob } from "../shared/dynamodb.js";
import { internalError } from "../shared/errors.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";
import { summarizeTranscript } from "../shared/transcript-format.js";
import { readTranscript } from "../shared/transcript-storage.js";

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
      languageCode: job.languageCode ?? process.env.DEFAULT_LANGUAGE_CODE ?? "en-US",
      wordCount: job.wordCount,
      failureReason: job.failureReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      links: {
        self: `/v1/transcriptions/${job.jobId}`,
        transcript: `/v1/transcriptions/${job.jobId}/transcript?format=txt`
      }
    };

    if (job.status === "COMPLETED" && event.queryStringParameters?.includeTranscript !== "false") {
      const transcriptBucket = process.env.TRANSCRIPT_BUCKET;
      if (!transcriptBucket) {
        throw internalError("Transcript bucket is not configured");
      }

      const payload = await readTranscript(job);
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
      const enrichment = await getEnrichmentRecord(auth.customerId, job.jobId);
      if (enrichment?.s3Key) {
        body.enrichmentJsonUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: transcriptBucket,
            Key: enrichment.s3Key
          }),
          { expiresIn: Number(process.env.TRANSCRIPT_PRESIGN_SECONDS ?? "900") }
        );
      }
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

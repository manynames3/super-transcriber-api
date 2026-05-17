import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { internalError } from "../shared/errors.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";
import { parseJsonBody, validateUploadRequest } from "../shared/validation.js";

const s3 = new S3Client({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event);
    const input = validateUploadRequest(parseJsonBody(event.body), auth.limits);
    const uploadBucket = process.env.UPLOAD_BUCKET;
    if (!uploadBucket) {
      throw internalError("Upload bucket is not configured");
    }

    const jobId = randomUUID();
    const expiresInSeconds = Number(process.env.UPLOAD_PRESIGN_SECONDS ?? "900");
    const s3Key = `customers/${auth.customerId}/uploads/${jobId}/${input.fileName}`;
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: uploadBucket,
        Key: s3Key,
        ContentType: input.contentType,
        Metadata: {
          customerId: auth.customerId,
          jobId,
          originalFileName: input.fileName
        }
      }),
      { expiresIn: expiresInSeconds }
    );

    logInfo("upload_presigned", {
      requestId: event.requestContext.requestId,
      customerId: auth.customerId,
      route: "POST /v1/uploads/presign",
      jobId
    });

    return jsonResponse(200, {
      uploadUrl,
      uploadMethod: "PUT",
      uploadHeaders: {
        "content-type": input.contentType
      },
      jobId,
      s3Key,
      expiresInSeconds,
      startRequest: {
        s3Key,
        fileName: input.fileName
      },
      pollUrl: `/v1/transcriptions/${jobId}`,
      links: {
        startTranscription: "/v1/transcriptions",
        jobStatus: `/v1/transcriptions/${jobId}`
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

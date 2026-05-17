import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { listJobs } from "../shared/dynamodb.js";
import { decodeCursor, encodeCursor, parsePageLimit } from "../shared/validation.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event);
    const limit = parsePageLimit(event.queryStringParameters?.limit);
    const cursor = decodeCursor(event.queryStringParameters?.cursor);
    const result = await listJobs(auth.customerId, limit, cursor);

    logInfo("transcriptions_listed", {
      requestId: event.requestContext.requestId,
      customerId: auth.customerId,
      route: "GET /v1/transcriptions"
    });

    return jsonResponse(200, {
      items: result.jobs.map((job) => ({
        jobId: job.jobId,
        status: job.status,
        fileName: job.fileName,
        durationSeconds: job.durationSeconds,
        wordCount: job.wordCount,
        failureReason: job.failureReason,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      })),
      nextCursor: result.cursor ? encodeCursor(result.cursor) : null
    });
  } catch (error) {
    return errorResponse(error);
  }
}

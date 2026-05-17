import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { requireVisibleJob, softDeleteJob } from "../shared/dynamodb.js";
import { internalError } from "../shared/errors.js";
import { emptyResponse, errorResponse, logInfo } from "../shared/response.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event);
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      throw internalError("Missing jobId route parameter");
    }

    await requireVisibleJob(auth.customerId, jobId);
    await softDeleteJob(auth.customerId, jobId);

    logInfo("transcription_deleted", {
      requestId: event.requestContext.requestId,
      customerId: auth.customerId,
      route: "DELETE /v1/transcriptions/{jobId}",
      jobId
    });

    return emptyResponse();
  } catch (error) {
    return errorResponse(error);
  }
}

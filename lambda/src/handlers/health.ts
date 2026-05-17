import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { jsonResponse } from "../shared/response.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, {
    ok: true,
    service: "super-transcriber-api",
    version: process.env.BUILD_VERSION ?? "dev",
    requestId: event.requestContext.requestId
  });
}

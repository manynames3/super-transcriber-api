import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ApiError, internalError } from "./errors.js";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body)
  };
}

export function emptyResponse(statusCode = 204): APIGatewayProxyStructuredResultV2 {
  return { statusCode };
}

export function errorResponse(error: unknown): APIGatewayProxyStructuredResultV2 {
  const apiError = error instanceof ApiError ? error : internalError();
  return jsonResponse(apiError.statusCode, {
    success: false,
    error: apiError.message,
    code: apiError.code
  });
}

export async function handleJson<T>(handler: () => Promise<T>): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    return jsonResponse(200, await handler());
  } catch (error) {
    return errorResponse(error);
  }
}

export function logInfo(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", message, ...fields }));
}

export function logWarn(message: string, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ level: "warn", message, ...fields }));
}

export function logError(message: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "error", message, ...fields }));
}

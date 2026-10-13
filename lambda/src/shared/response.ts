import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ApiError, internalError } from "./errors.js";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
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
  if (!(error instanceof ApiError)) {
    logError("handler_unhandled_error", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error"
    });
  }

  const apiError = error instanceof ApiError ? error : internalError();
  const response = jsonResponse(apiError.statusCode, {
    success: false,
    error: apiError.message,
    code: apiError.code
  });
  if (apiError.statusCode === 429) response.headers = { ...response.headers, "retry-after": String(60 - new Date().getUTCSeconds()) };
  return response;
}

export async function handleJson<T>(handler: () => Promise<T>): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    return jsonResponse(200, await handler());
  } catch (error) {
    return errorResponse(error);
  }
}

export function logInfo(message: string, fields: Record<string, unknown> = {}): void {
  console.log(safeLog({ level: "info", message, ...fields }));
}

export function logWarn(message: string, fields: Record<string, unknown> = {}): void {
  console.warn(safeLog({ level: "warn", message, ...fields }));
}

export function logError(message: string, fields: Record<string, unknown> = {}): void {
  console.error(safeLog({ level: "error", message, ...fields }));
}

function safeLog(fields: Record<string, unknown>): string {
  return JSON.stringify(fields, (key, value) => {
    if (/^(apiKey|adminToken|claimToken|signingSecret|secretKey|webhookSecret)$/i.test(key)) return "[REDACTED]";
    return typeof value === "string" ? value.replace(/stapi_[a-f0-9]{18}_[A-Za-z0-9_-]{43}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9_-]+/g, "[REDACTED]") : value;
  });
}

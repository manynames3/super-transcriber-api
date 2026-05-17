export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message: string, code = "BAD_REQUEST"): ApiError {
  return new ApiError(400, code, message);
}

export function unauthorized(message = "Invalid or missing API key"): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Forbidden"): ApiError {
  return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(message = "Resource not found"): ApiError {
  return new ApiError(404, "NOT_FOUND", message);
}

export function conflict(message: string, code = "CONFLICT"): ApiError {
  return new ApiError(409, code, message);
}

export function quotaExceeded(message: string): ApiError {
  return new ApiError(429, "QUOTA_EXCEEDED", message);
}

export function notImplemented(message: string): ApiError {
  return new ApiError(501, "NOT_IMPLEMENTED", message);
}

export function upstreamFailure(message: string): ApiError {
  return new ApiError(502, "UPSTREAM_FAILURE", message);
}

export function internalError(message = "Internal server error"): ApiError {
  return new ApiError(500, "INTERNAL_ERROR", message);
}

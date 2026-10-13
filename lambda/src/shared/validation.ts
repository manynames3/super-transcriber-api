import { Buffer } from "node:buffer";
import { basename } from "node:path";
import { ApiError, badRequest } from "./errors.js";
import { isIP } from "node:net";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
export const DEFAULT_MAX_DURATION_SECONDS = 20 * 60;
export const DEFAULT_MONTHLY_MINUTES = 120;
export const DEFAULT_MAX_ACTIVE_JOBS = 5;

const allowedExtensions = new Set(["mp3", "m4a"]);
const allowedContentTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "video/mp4"
]);

export interface LimitConfig {
  maxActiveJobs: number;
  maxFileSizeBytes: number;
  maxDurationSeconds: number;
  monthlyTranscriptionMinutes: number;
}

export interface UploadRequest {
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
}

export interface CreateTranscriptionRequest {
  s3Key?: string;
  sourceUrl?: string;
  fileName?: string;
  durationSeconds?: number;
  speakerCount?: number;
  languageCode?: string;
}

export interface ConfigureWebhookRequest {
  url: string;
  events: Array<"transcription.completed" | "transcription.failed">;
  enabled: boolean;
}

export interface CreateCheckoutRequest {
  email: string;
  planId: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface ClaimCheckoutRequest {
  checkoutSessionId: string;
  claimToken: string;
  recover?: boolean;
}

export interface BillingPortalRequest {
  returnUrl: string;
}

export function parseJsonBody<T>(body: string | null | undefined): T {
  if (!body) {
    throw badRequest("Request body must be valid JSON", "INVALID_JSON");
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw badRequest("Request body must be a JSON object", "INVALID_JSON");
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw badRequest("Request body must be valid JSON", "INVALID_JSON");
  }
}

export function getLimitConfigFromEnv(): LimitConfig {
  return {
    maxActiveJobs: readPositiveInteger("MAX_ACTIVE_JOBS", DEFAULT_MAX_ACTIVE_JOBS),
    maxFileSizeBytes: readPositiveInteger("MAX_FILE_SIZE_BYTES", DEFAULT_MAX_FILE_SIZE_BYTES),
    maxDurationSeconds: readPositiveInteger("MAX_DURATION_SECONDS", DEFAULT_MAX_DURATION_SECONDS),
    monthlyTranscriptionMinutes: readPositiveInteger("MONTHLY_TRANSCRIPTION_MINUTES", DEFAULT_MONTHLY_MINUTES)
  };
}

export function mergeLimitConfig(defaults: LimitConfig, overrides?: Partial<LimitConfig>): LimitConfig {
  const merged = {
    maxActiveJobs: overrides?.maxActiveJobs ?? defaults.maxActiveJobs,
    maxFileSizeBytes: overrides?.maxFileSizeBytes ?? defaults.maxFileSizeBytes,
    maxDurationSeconds: overrides?.maxDurationSeconds ?? defaults.maxDurationSeconds,
    monthlyTranscriptionMinutes: overrides?.monthlyTranscriptionMinutes ?? defaults.monthlyTranscriptionMinutes
  };
  if (Object.values(merged).some(value => !Number.isSafeInteger(value) || value <= 0) || merged.maxFileSizeBytes > DEFAULT_MAX_FILE_SIZE_BYTES) {
    throw badRequest("Usage limits must be positive integers; files cannot exceed 200 MB", "INVALID_LIMITS");
  }
  return merged;
}

export function sanitizeFileName(fileName: string): string {
  const cleaned = basename(fileName).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw badRequest("fileName must include a usable file name", "INVALID_FILE_NAME");
  }
  return cleaned;
}

export function validateUploadRequest(input: unknown, limits: LimitConfig): UploadRequest {
  const record = asRecord(input);
  const fileName = requireString(record, "fileName");
  const contentType = requireString(record, "contentType").toLowerCase();
  const fileSizeBytes = requirePositiveInteger(record, "fileSizeBytes");

  assertAllowedAudio(fileName, contentType);
  assertFileSize(fileSizeBytes, limits.maxFileSizeBytes);

  return {
    fileName: sanitizeFileName(fileName),
    contentType,
    fileSizeBytes
  };
}

export function validateCreateTranscriptionRequest(input: unknown, limits: LimitConfig): CreateTranscriptionRequest {
  const record = asRecord(input);
  const providedFileName = optionalString(record, "fileName");
  const s3Key = optionalString(record, "s3Key");
  const sourceUrl = optionalString(record, "sourceUrl");
  const durationSeconds = optionalPositiveInteger(record, "durationSeconds");
  const speakerCount = optionalPositiveInteger(record, "speakerCount");
  const languageCode = optionalString(record, "languageCode");
  if (languageCode && !/^[a-z]{2,3}-[A-Z]{2}$/.test(languageCode)) throw badRequest("languageCode must be an Amazon Transcribe language code such as en-US", "INVALID_LANGUAGE");

  if ((s3Key && sourceUrl) || (!s3Key && !sourceUrl)) {
    throw badRequest("Provide exactly one of s3Key or sourceUrl", "INVALID_SOURCE");
  }

  const fileName = providedFileName ? sanitizeFileName(providedFileName) : s3Key ? parseOwnedUploadS3Key("", s3Key, false).fileName : undefined;
  if (!fileName) {
    throw badRequest("fileName is required", "INVALID_FILE_NAME");
  }

  assertAllowedAudio(fileName);
  assertDuration(durationSeconds, limits.maxDurationSeconds);

  if (speakerCount !== undefined && (speakerCount < 1 || speakerCount > 10)) {
    throw badRequest("speakerCount must be between 1 and 10", "INVALID_SPEAKER_COUNT");
  }

  return {
    fileName,
    s3Key,
    sourceUrl,
    durationSeconds,
    speakerCount,
    languageCode
  };
}

export function assertFileSize(fileSizeBytes: number, maxFileSizeBytes: number): void {
  if (fileSizeBytes > maxFileSizeBytes) {
    throw badRequest(`File size exceeds the ${maxFileSizeBytes} byte limit`, "FILE_TOO_LARGE");
  }
}

export function assertDuration(durationSeconds: number | undefined, maxDurationSeconds: number): void {
  if (durationSeconds !== undefined && durationSeconds > maxDurationSeconds) {
    throw badRequest(`durationSeconds exceeds the ${maxDurationSeconds} second limit`, "DURATION_TOO_LONG");
  }
}

export function parseOwnedUploadS3Key(
  customerId: string,
  s3Key: string,
  enforceCustomerPrefix = true
): { jobId: string; fileName: string } {
  const escapedCustomerId = escapeRegex(customerId);
  const pattern = enforceCustomerPrefix
    ? new RegExp(`^customers/${escapedCustomerId}/uploads/([0-9a-f-]{36})/([^/]+)$`)
    : /^customers\/[^/]+\/uploads\/([0-9a-f-]{36})\/([^/]+)$/;
  const match = pattern.exec(s3Key);

  if (!match || s3Key.includes("..")) {
    throw badRequest("s3Key must come from POST /v1/uploads/presign for this API key", "INVALID_S3_KEY");
  }

  return {
    jobId: match[1],
    fileName: sanitizeFileName(match[2])
  };
}

export function monthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("cursor must decode to an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw badRequest("cursor is invalid", "INVALID_CURSOR");
  }
}

export function parsePageLimit(value: string | undefined, defaultLimit = 20, maxLimit = 100): number {
  if (!value) {
    return defaultLimit;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxLimit) {
    throw badRequest(`limit must be an integer between 1 and ${maxLimit}`, "INVALID_LIMIT");
  }
  return parsed;
}

export function validateConfigureWebhookRequest(input: unknown): ConfigureWebhookRequest {
  const record = asRecord(input);
  const url = requireString(record, "url");
  const parsedUrl = parseWebhookUrl(url);
  const events = parseWebhookEvents(record.events);
  const enabled = typeof record.enabled === "boolean" ? record.enabled : true;

  return {
    url: parsedUrl.toString(),
    events,
    enabled
  };
}

export function validateCreateCheckoutRequest(input: unknown): CreateCheckoutRequest {
  const record = asRecord(input);
  const email = requireString(record, "email").toLowerCase();
  const planId = requireString(record, "planId");
  const successUrl = optionalString(record, "successUrl");
  const cancelUrl = optionalString(record, "cancelUrl");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw badRequest("email must be a valid email address", "INVALID_EMAIL");
  }
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(planId)) {
    throw badRequest("planId is invalid", "INVALID_PLAN");
  }

  return {
    email,
    planId,
    successUrl: successUrl ? parseRedirectUrl(successUrl).toString() : undefined,
    cancelUrl: cancelUrl ? parseRedirectUrl(cancelUrl).toString() : undefined
  };
}

export function validateClaimCheckoutRequest(input: unknown): ClaimCheckoutRequest {
  const record = asRecord(input);
  return {
    checkoutSessionId: requireString(record, "checkoutSessionId"),
    claimToken: requireString(record, "claimToken"),
    recover: record.recover === true
  };
}

export function validateBillingPortalRequest(input: unknown): BillingPortalRequest {
  const record = asRecord(input);
  return {
    returnUrl: parseRedirectUrl(requireString(record, "returnUrl")).toString()
  };
}

function assertAllowedAudio(fileName: string, contentType?: string): void {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension || !allowedExtensions.has(extension)) {
    throw badRequest("Only mp3 and m4a files are supported", "UNSUPPORTED_MEDIA_TYPE");
  }

  if (contentType && !allowedContentTypes.has(contentType)) {
    throw badRequest("contentType must be an mp3 or m4a audio type", "UNSUPPORTED_MEDIA_TYPE");
  }
}

export function parseWebhookUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw badRequest("url must be a valid URL", "INVALID_WEBHOOK_URL");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443") || hostname === "localhost" || hostname.endsWith(".local") || (isIP(hostname) && !isPublicAddress(hostname))) {
    throw badRequest("Webhook URL must use HTTPS on a public host without credentials", "INVALID_WEBHOOK_URL");
  }
  return parsed;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:0?db8:/i.test(address);
  return false;
}

function parseRedirectUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw badRequest("redirect URL must be valid", "INVALID_REDIRECT_URL");
  }

  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocalhost && parsed.protocol === "http:")) {
    throw badRequest("redirect URL must use https, except localhost for development", "INVALID_REDIRECT_URL");
  }
  return parsed;
}

function parseWebhookEvents(value: unknown): Array<"transcription.completed" | "transcription.failed"> {
  const defaultEvents: Array<"transcription.completed" | "transcription.failed"> = [
    "transcription.completed",
    "transcription.failed"
  ];
  if (value === undefined || value === null) {
    return defaultEvents;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest("events must be a non-empty array", "INVALID_WEBHOOK_EVENTS");
  }

  const allowed = new Set(defaultEvents);
  return value.map((event) => {
    if (typeof event !== "string" || !allowed.has(event as "transcription.completed" | "transcription.failed")) {
      throw badRequest("events contains an unsupported webhook event", "INVALID_WEBHOOK_EVENTS");
    }
    return event as "transcription.completed" | "transcription.failed";
  });
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("Request body must be a JSON object", "INVALID_REQUEST");
  }
  return input as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${key} is required`, "INVALID_REQUEST");
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badRequest(`${key} must be a string`, "INVALID_REQUEST");
  }
  return value.trim();
}

function requirePositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw badRequest(`${key} must be a positive integer`, "INVALID_REQUEST");
  }
  return Number(value);
}

function optionalPositiveInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw badRequest(`${key} must be a positive integer`, "INVALID_REQUEST");
  }
  return Number(value);
}

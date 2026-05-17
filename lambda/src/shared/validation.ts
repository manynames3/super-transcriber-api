import { Buffer } from "node:buffer";
import { basename } from "node:path";
import { ApiError, badRequest } from "./errors.js";

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
  fileName: string;
  durationSeconds?: number;
  speakerCount?: number;
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
  return {
    maxActiveJobs: overrides?.maxActiveJobs ?? defaults.maxActiveJobs,
    maxFileSizeBytes: overrides?.maxFileSizeBytes ?? defaults.maxFileSizeBytes,
    maxDurationSeconds: overrides?.maxDurationSeconds ?? defaults.maxDurationSeconds,
    monthlyTranscriptionMinutes: overrides?.monthlyTranscriptionMinutes ?? defaults.monthlyTranscriptionMinutes
  };
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
  const fileName = sanitizeFileName(requireString(record, "fileName"));
  const s3Key = optionalString(record, "s3Key");
  const sourceUrl = optionalString(record, "sourceUrl");
  const durationSeconds = optionalPositiveInteger(record, "durationSeconds");
  const speakerCount = optionalPositiveInteger(record, "speakerCount");

  if ((s3Key && sourceUrl) || (!s3Key && !sourceUrl)) {
    throw badRequest("Provide exactly one of s3Key or sourceUrl", "INVALID_SOURCE");
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
    speakerCount
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

export function reservedDurationSeconds(durationSeconds: number | undefined, maxDurationSeconds: number): number {
  return durationSeconds ?? maxDurationSeconds;
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

function assertAllowedAudio(fileName: string, contentType?: string): void {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension || !allowedExtensions.has(extension)) {
    throw badRequest("Only mp3 and m4a files are supported", "UNSUPPORTED_MEDIA_TYPE");
  }

  if (contentType && !allowedContentTypes.has(contentType)) {
    throw badRequest("contentType must be an mp3 or m4a audio type", "UNSUPPORTED_MEDIA_TYPE");
  }
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

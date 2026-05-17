import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ACTIVE_JOBS,
  DEFAULT_MAX_DURATION_SECONDS,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MONTHLY_MINUTES,
  decodeCursor,
  encodeCursor,
  validateCreateTranscriptionRequest,
  validateUploadRequest,
  type LimitConfig
} from "../shared/validation.js";

const limits: LimitConfig = {
  maxActiveJobs: DEFAULT_MAX_ACTIVE_JOBS,
  maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
  maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
  monthlyTranscriptionMinutes: DEFAULT_MONTHLY_MINUTES
};

describe("request validation", () => {
  it("accepts mp3 and m4a uploads under the configured size limit", () => {
    expect(
      validateUploadRequest(
        {
          fileName: "meeting.mp3",
          contentType: "audio/mpeg",
          fileSizeBytes: 1024
        },
        limits
      )
    ).toEqual({
      fileName: "meeting.mp3",
      contentType: "audio/mpeg",
      fileSizeBytes: 1024
    });

    expect(
      validateUploadRequest(
        {
          fileName: "call.m4a",
          contentType: "audio/x-m4a",
          fileSizeBytes: 2048
        },
        limits
      ).fileName
    ).toBe("call.m4a");
  });

  it("rejects unsupported files and oversize uploads", () => {
    expect(() =>
      validateUploadRequest(
        {
          fileName: "notes.wav",
          contentType: "audio/wav",
          fileSizeBytes: 1024
        },
        limits
      )
    ).toThrow(/Only mp3 and m4a/);

    expect(() =>
      validateUploadRequest(
        {
          fileName: "meeting.mp3",
          contentType: "audio/mpeg",
          fileSizeBytes: limits.maxFileSizeBytes + 1
        },
        limits
      )
    ).toThrow(/File size exceeds/);
  });

  it("requires exactly one transcription source", () => {
    expect(
      validateCreateTranscriptionRequest(
        {
          s3Key: "customers/c/uploads/j/file.mp3",
          fileName: "file.mp3",
          durationSeconds: 60,
          speakerCount: 2
        },
        limits
      ).s3Key
    ).toBe("customers/c/uploads/j/file.mp3");

    expect(() => validateCreateTranscriptionRequest({ fileName: "file.mp3" }, limits)).toThrow(/exactly one/);
  });

  it("round-trips pagination cursors", () => {
    const cursor = { PK: "CUSTOMER#c", SK: "JOB#j" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });
});

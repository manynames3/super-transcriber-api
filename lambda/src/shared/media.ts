import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import {
  CopyObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { parseFile } from "music-metadata";
import { badRequest } from "./errors.js";
import { assertDuration, assertFileSize } from "./validation.js";
import type { JobRecord } from "./dynamodb.js";

const s3 = new S3Client({});

export async function verifyAudio(job: JobRecord): Promise<number> {
  const bucket = process.env.UPLOAD_BUCKET;
  if (!bucket || !job.processingS3Key || !job.uploadETag)
    throw new Error("Verified media configuration is missing");
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: job.processingS3Key,
      CopySource: `${bucket}/${job.s3Key.split("/").map(encodeURIComponent).join("/")}`,
      CopySourceIfMatch: job.uploadETag,
    }),
  );
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: job.processingS3Key }),
  );
  const maxBytes = job.limits?.maxFileSizeBytes ?? 200 * 1024 * 1024;
  if (!result.Body || !result.ContentLength)
    throw badRequest("Uploaded audio is empty", "INVALID_AUDIO");
  assertFileSize(result.ContentLength, maxBytes);
  const dir = await mkdtemp(join(tmpdir(), "st-audio-"));
  const path = join(dir, job.fileName);
  let bytes = 0;
  try {
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes)
          callback(
            badRequest("Audio exceeds file size limit", "FILE_TOO_LARGE"),
          );
        else callback(null, chunk);
      },
    });
    await pipeline(result.Body as Readable, bounded, createWriteStream(path));
    let metadata;
    try {
      metadata = await parseFile(path, { duration: true, skipCovers: true });
    } catch {
      throw badRequest(
        "Audio metadata is invalid or unsupported",
        "INVALID_AUDIO",
      );
    }
    const duration = metadata.format.duration;
    const mp3 = job.fileName.toLowerCase().endsWith(".mp3");
    const recognized = mp3
      ? /Layer 3|MP3/i.test(metadata.format.codec ?? "")
      : /M4A|MP4|MPEG-4|isom/i.test(metadata.format.container ?? "");
    if (
      !recognized ||
      !duration ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw badRequest(
        "File is not a valid MP3/M4A with a measurable duration",
        "INVALID_AUDIO",
      );
    }
    assertDuration(duration, job.limits?.maxDurationSeconds ?? 1200);
    return duration;
  } finally {
    (result.Body as Readable).destroy();
    await rm(dir, { recursive: true, force: true });
  }
}

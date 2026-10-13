import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ApiError } from "./errors.js";
import type { JobRecord } from "./dynamodb.js";

const s3 = new S3Client({});
export async function readTranscript(job: JobRecord): Promise<unknown> {
  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.TRANSCRIPT_BUCKET,
        Key: job.transcriptJsonS3Key,
      }),
    );
    const text = await result.Body?.transformToString();
    if (!text) throw new Error("Transcript object is empty");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchKey")
      throw new ApiError(
        410,
        "TRANSCRIPT_EXPIRED",
        "Transcript retention has expired",
      );
    throw error;
  }
}

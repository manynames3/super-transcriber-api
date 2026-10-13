import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getCustomer, getJob, getTranscribeMapping } from "./dynamodb.js";
import { finishJob } from "./ledger.js";
import { getPlan } from "./plans.js";
import { logInfo } from "./response.js";
import { getTranscribeJobStatus } from "./transcribe.js";
import { summarizeTranscript } from "./transcript-format.js";

const s3 = new S3Client({});

export async function completeTranscription(
  transcribeJobName: string,
): Promise<void> {
  const mapping = await getTranscribeMapping(transcribeJobName);
  if (!mapping) return;
  const job = await getJob(mapping.customerId, mapping.jobId);
  if (!job || job.status === "COMPLETED" || job.status === "FAILED") return;
  const result = await getTranscribeJobStatus(transcribeJobName);
  if (result.status === "COMPLETED") {
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.TRANSCRIPT_BUCKET,
        Key: job.transcriptJsonS3Key,
      }),
    );
    const text = await object.Body?.transformToString();
    if (!text)
      throw new Error("Completed transcription has no transcript object");
    const summary = summarizeTranscript(JSON.parse(text));
    const customer = await getCustomer(job.customerId);
    const enrichment =
      process.env.AI_ENRICHMENT_ENABLED === "true" &&
      Boolean(
        customer?.planId &&
        customer.planId !== "manual" &&
        getPlan(customer.planId).enrichmentEnabled,
      );
    await finishJob(job, "COMPLETED", {
      wordCount: summary.wordCount,
      enrichment,
    });
  } else if (result.status === "FAILED") {
    await finishJob(job, "FAILED", {
      failureReason: result.failureReason ?? "Transcription failed",
    });
  }
  logInfo("transcription_reconciled", {
    customerId: job.customerId,
    jobId: job.jobId,
    status: result.status,
  });
}

import { completeTranscription } from "../shared/completion.js";
import { getJob, type JobRecord } from "../shared/dynamodb.js";
import {
  finishJob,
  queryPending,
  touchRecoveryCheck,
  type OutboxRecord,
} from "../shared/ledger.js";
import { dispatchOutbox } from "../shared/outbox.js";
import { enqueueTranscriptionStart } from "../shared/queue.js";
import { getTranscribeJobStatus } from "../shared/transcribe.js";

export async function handler(): Promise<void> {
  const stale = new Date(Date.now() - 10 * 60000).toISOString();
  for (const record of await queryPending<OutboxRecord>(
    "OUTBOX#PENDING",
    stale,
  ))
    await dispatchOutbox(record);
  for (const candidate of await queryPending<JobRecord>("ACTIVE#JOBS", stale)) {
    const job = await getJob(candidate.customerId, candidate.jobId);
    if (!job || job.status === "COMPLETED" || job.status === "FAILED") continue;
    if (Date.now() - Date.parse(job.createdAt) > 24 * 3600000) {
      await finishJob(job, "FAILED", {
        failureReason: "Job exceeded the 24-hour processing deadline",
      });
      continue;
    }
    if (job.status === "QUEUED") {
      await enqueueTranscriptionStart(job);
      await touchRecoveryCheck(job);
      continue;
    }
    try {
      const status = await getTranscribeJobStatus(job.transcribeJobName);
      if (status.status === "COMPLETED" || status.status === "FAILED")
        await completeTranscription(job.transcribeJobName);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "BadRequestException" ||
          error.name === "NotFoundException") &&
        job.status === "STARTING"
      )
        await enqueueTranscriptionStart(job);
      else throw error;
    }
    await touchRecoveryCheck(job);
  }
}

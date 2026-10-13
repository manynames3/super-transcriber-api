import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { requireVisibleJob } from "../shared/dynamodb.js";
import { badRequest, conflict } from "../shared/errors.js";
import { errorResponse } from "../shared/response.js";
import {
  normalizeTranscript,
  renderSubtitles,
} from "../shared/transcript-format.js";
import { readTranscript } from "../shared/transcript-storage.js";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event, { scope: "transcriptions:read" });
    const format = event.queryStringParameters?.format ?? "txt";
    if (!["txt", "json", "srt", "vtt"].includes(format))
      throw badRequest(
        "format must be txt, json, srt, or vtt",
        "INVALID_FORMAT",
      );
    const job = await requireVisibleJob(
      auth.customerId,
      event.pathParameters?.jobId ?? "",
    );
    if (job.status !== "COMPLETED")
      throw conflict("Transcript is not ready", "TRANSCRIPT_NOT_READY");
    const normalized = normalizeTranscript(await readTranscript(job));
    const body =
      format === "txt"
        ? normalized.transcriptText
        : format === "json"
          ? JSON.stringify({
              jobId: job.jobId,
              durationSeconds: job.durationSeconds,
              languageCode:
                job.languageCode ??
                process.env.DEFAULT_LANGUAGE_CODE ??
                "en-US",
              ...normalized,
            })
          : renderSubtitles(normalized.segments, format as "srt" | "vtt");
    const type = {
      txt: "text/plain",
      json: "application/json",
      srt: "application/x-subrip",
      vtt: "text/vtt",
    }[format];
    const fileName = `${job.fileName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]/g, "_")}.${format}`;
    return {
      statusCode: 200,
      headers: {
        "content-type": `${type}; charset=utf-8`,
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "private, no-store",
      },
      body,
    };
  } catch (error) {
    return errorResponse(error);
  }
}

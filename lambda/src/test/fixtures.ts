import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { JobRecord } from "../shared/dynamodb.js";

export const job: JobRecord = {
  PK: "CUSTOMER#cust_test", SK: "JOB#00000000-0000-4000-8000-000000000001", GSI2PK: "JOBS#cust_test", GSI2SK: "2026-10-13#job",
  recordType: "JOB", jobId: "00000000-0000-4000-8000-000000000001", customerId: "cust_test", status: "IN_PROGRESS", s3Key: "customers/cust_test/uploads/00000000-0000-4000-8000-000000000001/meeting.mp3",
  fileName: "meeting.mp3", durationSeconds: 61.4, speakerCount: 2, reservedDurationSeconds: 62, wordCount: 0, failureReason: null,
  deleted: false, transcribeJobName: "st-test", transcriptJsonS3Key: "customers/cust_test/transcripts/job.json", usageMonth: "2026-10",
  createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z", meteringVersion: 2, capacityReserved: true, usageReserved: true,
  limits: { maxActiveJobs: 5, maxFileSizeBytes: 209715200, maxDurationSeconds: 1200, monthlyTranscriptionMinutes: 120 }
};

export function apiEvent(routeKey: string, extra: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return { version: "2.0", routeKey, rawPath: "/v1/transcriptions", rawQueryString: "", headers: {}, isBase64Encoded: false,
    requestContext: { accountId: "test", apiId: "test", domainName: "api.example", domainPrefix: "api", requestId: "test-request", routeKey, stage: "$default",
      time: "", timeEpoch: 0, http: { method: routeKey.split(" ")[0], path: "/v1/transcriptions", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" } }, ...extra };
}

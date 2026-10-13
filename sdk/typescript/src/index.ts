export type JobStatus =
  | "PENDING_UPLOAD"
  | "QUEUED"
  | "STARTING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";
export type TranscriptFormat = "txt" | "json" | "srt" | "vtt";
export interface SuperTranscriberClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maxRetries?: number;
}
export interface PresignUploadRequest {
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
}
export interface PresignUploadResponse {
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
  jobId: string;
  s3Key: string;
  expiresInSeconds: number;
  startRequest: { s3Key: string; fileName: string };
  pollUrl: string;
}
export interface CreateTranscriptionRequest {
  s3Key?: string;
  sourceUrl?: string;
  fileName?: string;
  durationSeconds?: number;
  speakerCount?: number;
  languageCode?: string;
}
export interface CreateTranscriptionResponse {
  jobId: string;
  status: JobStatus;
  pollUrl: string;
}
export interface TranscriptionJob {
  jobId: string;
  status: JobStatus;
  fileName: string;
  durationSeconds: number | null;
  wordCount: number;
  failureReason: string | null;
  transcriptText?: string;
  transcriptJsonUrl?: string;
  enrichmentJsonUrl?: string;
  languageCode?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ListTranscriptionsResponse {
  items: TranscriptionJob[];
  nextCursor: string | null;
  hasMore: boolean;
}
export interface ConfigureWebhookRequest {
  url: string;
  events?: Array<"transcription.completed" | "transcription.failed">;
  enabled?: boolean;
}
export interface CreateCheckoutRequest {
  email: string;
  planId: string;
  successUrl?: string;
  cancelUrl?: string;
}
export interface CreateCheckoutResponse {
  checkoutUrl: string;
  checkoutSessionId: string;
  claimToken: string;
  expiresAt: string;
}
export interface ClaimCheckoutResponse {
  customerId: string;
  planId: string;
  billingStatus: string;
  keyId: string;
  keyPrefix: string;
  apiKey: string;
  createdAt: string;
}
export interface WaitOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
}
export interface ApiKeySummary {
  keyId: string;
  keyPrefix: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  scopes: string[];
  createdAt: string;
}
export interface ApiKeyResponse {
  keyId: string;
  keyPrefix: string;
  apiKey: string;
  scopes: string[];
}
export interface NormalizedTranscript {
  jobId: string;
  transcriptText: string;
  wordCount: number;
  durationSeconds: number | null;
  languageCode: string;
  words: Array<{
    text: string;
    start: number;
    end: number;
    speaker: string | null;
    confidence: number | null;
  }>;
  segments: Array<{
    text: string;
    start: number;
    end: number;
    speaker: string | null;
  }>;
}

export class SuperTranscriberError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SuperTranscriberError";
  }
}

export class SuperTranscriberClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: SuperTranscriberClientOptions) {
    if (options.baseUrl.length > 8192) throw new Error("baseUrl is too long");
    const base = new URL(options.baseUrl);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash)
      throw new Error("baseUrl must be an HTTP(S) URL without credentials, query, or fragment");
    let end = base.href.length;
    while (base.href[end - 1] === "/") end--;
    this.baseUrl = base.href.slice(0, end);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 2;
    if (
      this.requestTimeoutMs <= 0 ||
      this.maxRetries < 0 ||
      !Number.isInteger(this.maxRetries)
    )
      throw new Error("Invalid timeout or retry configuration");
  }

  async presignUpload(
    input: PresignUploadRequest,
    signal?: AbortSignal,
  ): Promise<PresignUploadResponse> {
    return this.request(
      "POST",
      "/v1/uploads/presign",
      input,
      true,
      false,
      signal,
    );
  }
  async uploadFile(
    presign: PresignUploadResponse,
    body: BodyInit,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.timedFetch(
      presign.uploadUrl,
      { method: presign.uploadMethod, headers: presign.uploadHeaders, body },
      signal,
      300000,
    );
    if (!response.ok)
      throw new SuperTranscriberError(
        "UPLOAD_FAILED",
        `Upload failed with HTTP ${response.status}`,
        response.status,
      );
  }
  async createTranscription(
    input: CreateTranscriptionRequest,
    signal?: AbortSignal,
  ): Promise<CreateTranscriptionResponse> {
    return this.request(
      "POST",
      "/v1/transcriptions",
      input,
      true,
      true,
      signal,
    );
  }
  async getTranscription(
    jobId: string,
    options: { includeTranscript?: boolean; signal?: AbortSignal } = {},
  ): Promise<TranscriptionJob> {
    return this.request(
      "GET",
      `/v1/transcriptions/${encodeURIComponent(jobId)}${options.includeTranscript === false ? "?includeTranscript=false" : ""}`,
      undefined,
      true,
      true,
      options.signal,
    );
  }
  async listTranscriptions(
    params: { limit?: number; cursor?: string } = {},
  ): Promise<ListTranscriptionsResponse> {
    return this.request("GET", "/v1/transcriptions" + query(params));
  }
  async deleteTranscription(jobId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/v1/transcriptions/${encodeURIComponent(jobId)}`,
    );
  }
  async purgeTranscription(jobId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/v1/transcriptions/${encodeURIComponent(jobId)}/data`,
    );
  }
  async downloadTranscript(
    jobId: string,
    format: TranscriptFormat = "txt",
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.response(
      "GET",
      `/v1/transcriptions/${encodeURIComponent(jobId)}/transcript?format=${format}`,
      undefined,
      true,
      true,
      signal,
    );
    return response.text();
  }
  async waitForCompletion(
    jobId: string,
    options: WaitOptions = {},
  ): Promise<TranscriptionJob> {
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 1800000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline;
    try {
      for (;;) {
        signal.throwIfAborted();
        const job = await this.getTranscription(jobId, {
          includeTranscript: false,
          signal,
        });
        if (job.status === "COMPLETED")
          return this.getTranscription(jobId, { signal });
        if (job.status === "FAILED")
          throw new SuperTranscriberError(
            "TRANSCRIPTION_FAILED",
            job.failureReason ?? "Transcription failed",
            422,
          );
        await pause(options.pollIntervalMs ?? 2000, signal);
      }
    } catch (error) {
      if (deadline.aborted && !options.signal?.aborted)
        throw new SuperTranscriberError(
          "WAIT_TIMEOUT",
          "Timed out waiting; the server job continues processing",
          0,
        );
      throw error;
    }
  }
  async getTranscript(
    jobId: string,
    signal?: AbortSignal,
  ): Promise<NormalizedTranscript> {
    return JSON.parse(
      await this.downloadTranscript(jobId, "json", signal),
    ) as NormalizedTranscript;
  }
  async transcribeUpload(
    input: PresignUploadRequest,
    body: BodyInit,
    options: Omit<CreateTranscriptionRequest, "s3Key" | "fileName"> = {},
    signal?: AbortSignal,
  ): Promise<CreateTranscriptionResponse> {
    const presign = await this.presignUpload(input, signal);
    await this.uploadFile(presign, body, signal);
    return this.createTranscription(
      {
        ...options,
        s3Key: presign.s3Key,
        fileName: presign.startRequest.fileName,
      },
      signal,
    );
  }
  async transcribeFile(
    audio: Blob,
    options: {
      fileName: string;
      contentType?: string;
      speakerCount?: number;
      languageCode?: string;
    } & WaitOptions,
  ): Promise<TranscriptionJob> {
    const job = await this.transcribeUpload(
      {
        fileName: options.fileName,
        contentType:
          options.contentType ??
          (audio.type ||
            (options.fileName.toLowerCase().endsWith(".mp3")
              ? "audio/mpeg"
              : "audio/mp4")),
        fileSizeBytes: audio.size,
      },
      audio,
      {
        speakerCount: options.speakerCount,
        languageCode: options.languageCode,
      },
      options.signal,
    );
    return this.waitForCompletion(job.jobId, options);
  }
  async configureWebhook(
    input: ConfigureWebhookRequest,
  ): Promise<{
    url: string;
    events: string[];
    enabled: boolean;
    signingSecret?: string;
  }> {
    return this.request("POST", "/v1/webhooks", input, true, false);
  }
  async listWebhookDeliveries(
    params: { limit?: number; cursor?: string } = {},
  ): Promise<{
    items: Array<{
      eventId: string;
      jobId: string;
      status: string;
      attempts: number;
      lastError: string | null;
    }>;
    nextCursor: string | null;
  }> {
    return this.request("GET", "/v1/webhooks/deliveries" + query(params));
  }
  async replayWebhook(
    eventId: string,
  ): Promise<{ eventId: string; status: string }> {
    return this.request(
      "POST",
      `/v1/webhooks/deliveries/${encodeURIComponent(eventId)}/replay`,
      {},
      true,
      false,
    );
  }
  async createApiKey(input: {
    keyName?: string;
    scopes?: string[];
  }): Promise<ApiKeyResponse> {
    return this.request("POST", "/v1/api-keys", input, true, false);
  }
  async listApiKeys(
    params: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: ApiKeySummary[]; nextCursor: string | null }> {
    return this.request("GET", "/v1/api-keys" + query(params));
  }
  async revokeApiKey(
    keyId: string,
  ): Promise<{ keyId: string; status: string }> {
    return this.request("DELETE", `/v1/api-keys/${encodeURIComponent(keyId)}`);
  }
  async rotateApiKey(keyId: string): Promise<ApiKeyResponse> {
    return this.request(
      "POST",
      `/v1/api-keys/${encodeURIComponent(keyId)}/rotate`,
      {},
      true,
      false,
    );
  }
  async createCheckoutSession(
    input: CreateCheckoutRequest,
  ): Promise<CreateCheckoutResponse> {
    return this.request("POST", "/v1/billing/checkout", input, false, false);
  }
  async claimCheckoutSession(input: {
    checkoutSessionId: string;
    claimToken: string;
    recover?: boolean;
  }): Promise<ClaimCheckoutResponse> {
    return this.request("POST", "/v1/billing/claim", input, false, false);
  }
  async getBillingAccount(): Promise<{
    customerId: string;
    planId: string;
    billingStatus: string;
    limits: Record<string, number>;
    usage: {
      usageMonth: string;
      activeJobs: number;
      usedSeconds: number;
      reservedSeconds: number;
      usedMinutes: number;
      remainingMinutes: number;
    };
  }> {
    return this.request("GET", "/v1/billing/account");
  }
  async createBillingPortal(input: {
    returnUrl: string;
  }): Promise<{ portalUrl: string }> {
    return this.request("POST", "/v1/billing/portal", input, true, false);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    authenticated = true,
    retrySafe = method === "GET" || method === "DELETE",
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.response(
      method,
      path,
      body,
      authenticated,
      retrySafe,
      signal,
    );
    return response.status === 204
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }
  private async response(
    method: string,
    path: string,
    body?: unknown,
    authenticated = true,
    retrySafe = true,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (authenticated && !this.apiKey)
      throw new SuperTranscriberError(
        "API_KEY_REQUIRED",
        "apiKey is required",
        401,
      );
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (authenticated) headers["x-api-key"] = this.apiKey!;
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        const response = await this.timedFetch(
          this.baseUrl + path,
          {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          },
          signal,
        );
        if (response.ok) return response;
        const retryAfter =
          Number(response.headers.get("retry-after")) || undefined;
        if (
          retrySafe &&
          attempt < this.maxRetries &&
          [429, 502, 503, 504].includes(response.status)
        ) {
          await response.body?.cancel();
          await pause(
            (retryAfter ??
              Math.min(8, 0.5 * 2 ** attempt + Math.random() * 0.25)) * 1000,
            signal,
          );
          continue;
        }
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        throw new SuperTranscriberError(
          payload.code ?? "HTTP_ERROR",
          payload.error ?? `HTTP ${response.status}`,
          response.status,
          retryAfter,
        );
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (
          retrySafe &&
          attempt < this.maxRetries &&
          !(error instanceof SuperTranscriberError)
        ) {
          await pause(
            (0.5 * 2 ** attempt + Math.random() * 0.25) * 1000,
            signal,
          );
          continue;
        }
        throw error;
      }
    }
  }
  private async timedFetch(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timeout.aborted)
        throw new SuperTranscriberError(
          "REQUEST_TIMEOUT",
          "Request timed out",
          0,
        );
      throw error;
    }
  }
}

function query(params: { limit?: number; cursor?: string }): string {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  return query.size ? "?" + query.toString() : "";
}
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string,
  toleranceSeconds = 300,
  now = Date.now(),
): Promise<boolean> {
  const match = /^t=([^,]+),v1=([a-f0-9]{64})$/.exec(signature);
  if (
    !match ||
    !Number.isFinite(Date.parse(match[1])) ||
    Math.abs(now - Date.parse(match[1])) > toleranceSeconds * 1000
  )
    return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(match[2].match(/.{2}/g)!, (part) =>
    parseInt(part, 16),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    encoder.encode(match[1] + "." + body),
  );
}

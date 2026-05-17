export type JobStatus = "PENDING_UPLOAD" | "QUEUED" | "STARTING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface SuperTranscriberClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
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
  startRequest: {
    s3Key: string;
    fileName: string;
  };
  pollUrl: string;
}

export interface CreateTranscriptionRequest {
  s3Key?: string;
  sourceUrl?: string;
  fileName?: string;
  durationSeconds?: number;
  speakerCount?: number;
}

export interface CreateTranscriptionResponse {
  jobId: string;
  status: "QUEUED";
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

export class SuperTranscriberClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SuperTranscriberClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async presignUpload(input: PresignUploadRequest): Promise<PresignUploadResponse> {
    return this.request("POST", "/v1/uploads/presign", input);
  }

  async uploadFile(presign: PresignUploadResponse, body: BodyInit): Promise<void> {
    const response = await this.fetchImpl(presign.uploadUrl, {
      method: presign.uploadMethod,
      headers: presign.uploadHeaders,
      body
    });
    if (!response.ok) {
      throw new Error(`Upload failed with HTTP ${response.status}`);
    }
  }

  async createTranscription(input: CreateTranscriptionRequest): Promise<CreateTranscriptionResponse> {
    return this.request("POST", "/v1/transcriptions", input);
  }

  async getTranscription(jobId: string): Promise<TranscriptionJob> {
    return this.request("GET", `/v1/transcriptions/${encodeURIComponent(jobId)}`);
  }

  async listTranscriptions(params: { limit?: number; cursor?: string } = {}): Promise<ListTranscriptionsResponse> {
    const query = new URLSearchParams();
    if (params.limit) {
      query.set("limit", String(params.limit));
    }
    if (params.cursor) {
      query.set("cursor", params.cursor);
    }
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.request("GET", `/v1/transcriptions${suffix}`);
  }

  async deleteTranscription(jobId: string): Promise<void> {
    await this.request("DELETE", `/v1/transcriptions/${encodeURIComponent(jobId)}`);
  }

  async configureWebhook(input: ConfigureWebhookRequest): Promise<{
    url: string;
    events: Array<"transcription.completed" | "transcription.failed">;
    enabled: boolean;
    signingSecret?: string;
  }> {
    return this.request("POST", "/v1/webhooks", input);
  }

  async createCheckoutSession(input: CreateCheckoutRequest): Promise<CreateCheckoutResponse> {
    return this.request("POST", "/v1/billing/checkout", input, false);
  }

  async claimCheckoutSession(input: { checkoutSessionId: string; claimToken: string }): Promise<ClaimCheckoutResponse> {
    return this.request("POST", "/v1/billing/claim", input, false);
  }

  async getBillingAccount(): Promise<{
    customerId: string;
    planId: string;
    billingStatus: string;
    limits: Record<string, number>;
    stripeCustomerId?: string;
  }> {
    return this.request("GET", "/v1/billing/account");
  }

  async createBillingPortal(input: { returnUrl: string }): Promise<{ portalUrl: string }> {
    return this.request("POST", "/v1/billing/portal", input);
  }

  async transcribeUpload(input: PresignUploadRequest, body: BodyInit, options: Omit<CreateTranscriptionRequest, "s3Key" | "fileName"> = {}): Promise<CreateTranscriptionResponse> {
    const presign = await this.presignUpload(input);
    await this.uploadFile(presign, body);
    return this.createTranscription({
      ...options,
      s3Key: presign.s3Key
    });
  }

  private async request<T>(method: string, path: string, body?: unknown, authenticated = true): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (authenticated) {
      if (!this.apiKey) {
        throw new Error("apiKey is required for authenticated Super Transcriber API calls");
      }
      headers["x-api-key"] = this.apiKey;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = (await response.json()) as T | { success: false; error: string; code: string };
    if (!response.ok) {
      const errorPayload = payload as { success?: false; error?: string; code?: string };
      throw new Error(`${errorPayload.code ?? response.status}: ${errorPayload.error ?? response.statusText}`);
    }
    return payload as T;
  }
}

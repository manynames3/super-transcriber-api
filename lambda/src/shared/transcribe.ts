import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
  type LanguageCode,
  type TranscriptionJobStatus
} from "@aws-sdk/client-transcribe";

const client = new TranscribeClient({});

export interface StartTranscribeInput {
  customerId: string;
  jobId: string;
  transcribeJobName: string;
  s3Key: string;
  fileName: string;
  speakerCount?: number;
  transcriptJsonS3Key: string;
  languageCode?: string;
}

export async function startTranscribeJob(input: StartTranscribeInput): Promise<void> {
  const uploadBucket = requireEnv("UPLOAD_BUCKET");
  const transcriptBucket = requireEnv("TRANSCRIPT_BUCKET");
  const languageCode = input.languageCode ?? process.env.DEFAULT_LANGUAGE_CODE ?? "en-US";

  await client.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: input.transcribeJobName,
      LanguageCode: languageCode as LanguageCode,
      MediaFormat: inferMediaFormat(input.fileName),
      Media: {
        MediaFileUri: `s3://${uploadBucket}/${input.s3Key}`
      },
      OutputBucketName: transcriptBucket,
      OutputKey: input.transcriptJsonS3Key,
      Settings: {
        ShowSpeakerLabels: input.speakerCount !== 1,
        ...(input.speakerCount === 1 ? {} : { MaxSpeakerLabels: input.speakerCount ?? 2 })
      }
    })
  );
}

export async function getTranscribeJobStatus(transcribeJobName: string): Promise<{
  status?: TranscriptionJobStatus;
  failureReason?: string;
}> {
  const result = await client.send(
    new GetTranscriptionJobCommand({
      TranscriptionJobName: transcribeJobName
    })
  );

  return {
    status: result.TranscriptionJob?.TranscriptionJobStatus,
    failureReason: result.TranscriptionJob?.FailureReason
  };
}

function inferMediaFormat(fileName: string): "mp3" | "mp4" {
  return fileName.toLowerCase().endsWith(".mp3") ? "mp3" : "mp4";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

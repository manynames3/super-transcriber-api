export interface TranscriptSummary {
  transcriptText: string;
  wordCount: number;
}

export function summarizeTranscript(payload: unknown): TranscriptSummary {
  const transcriptText = extractTranscriptText(payload);
  return {
    transcriptText,
    wordCount: countWords(transcriptText)
  };
}

export function extractTranscriptText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const results = (payload as { results?: unknown }).results;
  if (!results || typeof results !== "object") {
    return "";
  }

  const transcripts = (results as { transcripts?: unknown }).transcripts;
  if (!Array.isArray(transcripts)) {
    return "";
  }

  return transcripts
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const transcript = (entry as { transcript?: unknown }).transcript;
      return typeof transcript === "string" ? transcript.trim() : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

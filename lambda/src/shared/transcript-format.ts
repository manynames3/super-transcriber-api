export interface TranscriptSummary {
  transcriptText: string;
  wordCount: number;
}

export function summarizeTranscript(payload: unknown): TranscriptSummary {
  const transcriptText = extractTranscriptText(payload);
  return {
    transcriptText,
    wordCount: countWords(transcriptText),
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

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  speaker: string | null;
  confidence: number | null;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  speaker: string | null;
}

export function normalizeTranscript(
  payload: unknown,
): TranscriptSummary & {
  words: TranscriptWord[];
  segments: TranscriptSegment[];
} {
  const result = payload as {
    results?: {
      items?: Array<{
        type?: string;
        start_time?: string;
        end_time?: string;
        speaker_label?: string;
        alternatives?: Array<{ content?: string; confidence?: string }>;
      }>;
      speaker_labels?: {
        segments?: Array<{
          speaker_label?: string;
          items?: Array<{ start_time?: string }>;
        }>;
      };
    };
  };
  const labels = new Map<string, string>();
  for (const segment of result?.results?.speaker_labels?.segments ?? []) {
    for (const item of segment.items ?? [])
      if (item.start_time && segment.speaker_label)
        labels.set(item.start_time, segment.speaker_label);
  }
  const words: TranscriptWord[] = [];
  for (const item of result?.results?.items ?? []) {
    const alternative = item.alternatives?.[0];
    if (item.type === "punctuation") {
      if (words.length)
        words[words.length - 1].text += alternative?.content ?? "";
      continue;
    }
    const start = Number(item.start_time),
      end = Number(item.end_time);
    if (
      !alternative?.content ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start ||
      start < 0
    )
      continue;
    const confidence =
      alternative.confidence === undefined
        ? null
        : Number(alternative.confidence);
    words.push({
      text: alternative.content,
      start,
      end,
      speaker: item.speaker_label ?? labels.get(item.start_time ?? "") ?? null,
      confidence:
        confidence !== null && Number.isFinite(confidence) ? confidence : null,
    });
  }
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | undefined;
  let size = 0;
  for (const word of words) {
    if (
      !current ||
      current.speaker !== word.speaker ||
      word.start - current.end > 1.2 ||
      word.end - current.start > 6 ||
      size >= 16
    ) {
      current = {
        text: word.text,
        start: word.start,
        end: word.end,
        speaker: word.speaker,
      };
      segments.push(current);
      size = 1;
    } else {
      current.text += ` ${word.text}`;
      current.end = word.end;
      size++;
    }
  }
  return { ...summarizeTranscript(payload), words, segments };
}

export function renderSubtitles(
  segments: TranscriptSegment[],
  format: "srt" | "vtt",
): string {
  const cues = segments.map((segment, index) => {
    const content =
      `${segment.speaker ? `${segment.speaker}: ` : ""}${segment.text}`
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replace(/[\r\n]+/g, " ");
    return `${format === "srt" ? `${index + 1}\n` : ""}${subtitleTime(segment.start, format)} --> ${subtitleTime(segment.end, format)}\n${content}`;
  });
  return `${format === "vtt" ? "WEBVTT\n\n" : ""}${cues.join("\n\n")}\n`;
}

function subtitleTime(seconds: number, format: "srt" | "vtt"): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000),
    minutes = Math.floor(ms / 60000) % 60,
    wholeSeconds = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}${format === "srt" ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
}

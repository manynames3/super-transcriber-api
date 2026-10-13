import { describe, expect, it } from "vitest";
import { countWords, extractTranscriptText, summarizeTranscript, normalizeTranscript, renderSubtitles } from "../shared/transcript-format.js";

it("normalizes punctuation, speaker changes, and timed subtitle cues", () => {
  const payload = { results: { transcripts: [{ transcript: "Hello team. Welcome." }], items: [
    { type: "pronunciation", start_time: "0.4", end_time: "0.8", speaker_label: "spk_0", alternatives: [{ content: "Hello", confidence: "0.99" }] },
    { type: "pronunciation", start_time: "0.9", end_time: "1.4", speaker_label: "spk_0", alternatives: [{ content: "team", confidence: "0.98" }] },
    { type: "punctuation", alternatives: [{ content: "." }] },
    { type: "pronunciation", start_time: "2", end_time: "2.6", speaker_label: "spk_1", alternatives: [{ content: "Welcome", confidence: "0.95" }] },
    { type: "punctuation", alternatives: [{ content: "." }] }
  ] } };
  const result = normalizeTranscript(payload);
  expect(result.words[1].text).toBe("team."); expect(result.segments).toHaveLength(2);
  expect(renderSubtitles(result.segments, "srt")).toContain("00:00:00,400 --> 00:00:01,400\nspk_0: Hello team.");
  expect(renderSubtitles(result.segments, "vtt")).toMatch(/^WEBVTT\n\n00:00:00\.400/);
});

describe("transcript formatting", () => {
  it("extracts transcript text from Amazon Transcribe JSON", () => {
    const payload = {
      results: {
        transcripts: [{ transcript: "Hello world." }, { transcript: "Second sentence." }]
      }
    };

    expect(extractTranscriptText(payload)).toBe("Hello world.\nSecond sentence.");
    expect(summarizeTranscript(payload)).toEqual({
      transcriptText: "Hello world.\nSecond sentence.",
      wordCount: 4
    });
  });

  it("handles empty payloads", () => {
    expect(extractTranscriptText({})).toBe("");
    expect(countWords("")).toBe(0);
  });
});

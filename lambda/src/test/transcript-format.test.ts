import { describe, expect, it } from "vitest";
import { countWords, extractTranscriptText, summarizeTranscript } from "../shared/transcript-format.js";

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

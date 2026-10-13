import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_DURATION_SECONDS,
  assertDuration,
  mergeLimitConfig,
  type LimitConfig
} from "../shared/validation.js";

const defaults: LimitConfig = {
  maxActiveJobs: 5,
  maxFileSizeBytes: 200,
  maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
  monthlyTranscriptionMinutes: 120
};

describe("usage limits", () => {
  it("rejects invalid account limit overrides", () => {
    expect(() => mergeLimitConfig(defaults, { maxActiveJobs: -1 })).toThrow();
    expect(() => mergeLimitConfig(defaults, { monthlyTranscriptionMinutes: 0.5 })).toThrow();
  });

  it("rejects durations above the account limit", () => {
    expect(() => assertDuration(defaults.maxDurationSeconds + 1, defaults.maxDurationSeconds)).toThrow(/durationSeconds/);
  });

  it("merges per-key limits with environment defaults", () => {
    expect(mergeLimitConfig(defaults, { maxActiveJobs: 2 })).toEqual({
      ...defaults,
      maxActiveJobs: 2
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_DURATION_SECONDS,
  assertDuration,
  mergeLimitConfig,
  reservedDurationSeconds,
  type LimitConfig
} from "../shared/validation.js";

const defaults: LimitConfig = {
  maxActiveJobs: 5,
  maxFileSizeBytes: 200,
  maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
  monthlyTranscriptionMinutes: 120
};

describe("usage limits", () => {
  it("reserves configured duration or the max duration when duration is absent", () => {
    expect(reservedDurationSeconds(90, defaults.maxDurationSeconds)).toBe(90);
    expect(reservedDurationSeconds(undefined, defaults.maxDurationSeconds)).toBe(defaults.maxDurationSeconds);
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

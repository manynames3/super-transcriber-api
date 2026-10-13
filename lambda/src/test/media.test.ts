import { expect, it } from "vitest";
import { parseFile } from "music-metadata";
import { fileURLToPath } from "node:url";

it("measures real MP3 and M4A fixtures using the production parser", async () => {
  const mp3 = await parseFile(fileURLToPath(new URL("./fixtures/tone.mp3", import.meta.url)), { duration: true });
  const m4a = await parseFile(fileURLToPath(new URL("./fixtures/tone.m4a", import.meta.url)), { duration: true });
  expect(mp3.format.duration).toBeGreaterThanOrEqual(1);
  expect(mp3.format.duration).toBeLessThan(1.2);
  expect(mp3.format.codec).toMatch(/Layer 3|MP3/i);
  expect(m4a.format.duration).toBeCloseTo(1, 1);
  expect(m4a.format.container).toMatch(/M4A|MP4|MPEG-4|isom/i);
});

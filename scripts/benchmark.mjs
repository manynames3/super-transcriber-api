import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SuperTranscriberClient } from "../sdk/typescript/dist/index.js";

const manifestPath = process.argv[2];
if (!manifestPath || !process.env.SUPER_TRANSCRIBER_API_KEY) throw new Error("Usage: SUPER_TRANSCRIBER_API_KEY=... API_BASE_URL=... node scripts/benchmark.mjs manifest.json [report.json]");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest) || !manifest.length) throw new Error("Manifest must contain audioFile, referenceText, and optional speakerCount/languageCode entries");
const client = new SuperTranscriberClient({ baseUrl: process.env.API_BASE_URL ?? "https://pn72sppog0.execute-api.us-east-1.amazonaws.com", apiKey: process.env.SUPER_TRANSCRIBER_API_KEY });
const results = [];
for (const entry of manifest) {
  if (typeof entry.audioFile !== "string" || typeof entry.referenceText !== "string") throw new Error("Invalid manifest entry");
  const audio = new Blob([await readFile(entry.audioFile)]);
  const start = performance.now();
  const job = await client.transcribeFile(audio, { fileName: entry.audioFile.split(/[\\/]/).at(-1), speakerCount: entry.speakerCount, languageCode: entry.languageCode });
  const expected = tokenize(entry.referenceText), actual = tokenize(job.transcriptText ?? "");
  let row = actual.map((_, index) => index + 1); row.unshift(0);
  for (let i = 1; i <= expected.length; i++) {
    const next = [i];
    for (let j = 1; j <= actual.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(expected[i - 1] !== actual[j - 1]));
    row = next;
  }
  results.push({ sample: entry.name ?? entry.audioFile.split(/[\\/]/).at(-1), jobId: job.jobId, durationSeconds: job.durationSeconds,
    elapsedSeconds: Number(((performance.now() - start) / 1000).toFixed(3)), referenceWords: expected.length,
    wordErrors: row[actual.length], wordErrorRate: expected.length ? row[actual.length] / expected.length : null });
  console.log(`Completed benchmark sample ${results.length}/${manifest.length}`);
}
const report = { recordedAt: new Date().toISOString(), apiBaseUrl: process.env.API_BASE_URL ?? "https://pn72sppog0.execute-api.us-east-1.amazonaws.com", samples: results };
const output = resolve(process.argv[3] ?? "artifacts/benchmark.json");
await import("node:fs/promises").then(fs => fs.mkdir(resolve(output, ".."), { recursive: true }));
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(`Saved measured results to ${output}. Sample results do not establish a production SLA.`);
function tokenize(text) { return text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean); }

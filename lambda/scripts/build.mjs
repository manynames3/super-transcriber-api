import { createWriteStream, rmSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import archiver from "archiver";
import { build } from "esbuild";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const distDir = join(root, "dist");
const handlerDir = join(distDir, "handlers");
const zipDir = join(distDir, "zips");

const handlers = [
  "health",
  "create-api-key",
  "create-checkout-session",
  "stripe-webhook",
  "claim-checkout-session",
  "get-billing-account",
  "create-billing-portal",
  "configure-webhook",
  "presign-upload",
  "create-transcription",
  "start-transcription",
  "get-transcription",
  "list-transcriptions",
  "delete-transcription",
  "completion",
  "deliver-webhook",
  "enrich-transcript"
];

rmSync(distDir, { recursive: true, force: true });
mkdirSync(handlerDir, { recursive: true });
mkdirSync(zipDir, { recursive: true });

async function zipHandler(name) {
  const outputPath = join(zipDir, `${name}.zip`);
  const output = createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  const done = new Promise((resolvePromise, rejectPromise) => {
    output.on("close", resolvePromise);
    archive.on("error", rejectPromise);
  });

  archive.pipe(output);
  archive.file(join(handlerDir, `${name}.js`), { name: "index.js" });
  await archive.finalize();
  await done;
}

for (const handler of handlers) {
  await build({
    entryPoints: [join(root, "src", "handlers", `${handler}.ts`)],
    outfile: join(handlerDir, `${handler}.js`),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    minify: false,
    logLevel: "info"
  });

  await zipHandler(handler);
}

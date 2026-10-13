# Benchmarking

Use representative, consented audio and a human-checked reference transcript. Include the languages, speakers, accents, noise, and recording devices relevant to your application; a synthetic smoke test cannot establish general accuracy.

Build the SDK, then prepare a JSON manifest:

```json
[
  {
    "name": "two-speaker-meeting",
    "audioFile": "samples/meeting.mp3",
    "referenceText": "The checked transcript of the recording.",
    "speakerCount": 2,
    "languageCode": "en-US"
  }
]
```

```bash
export SUPER_TRANSCRIBER_API_KEY="YOUR_API_KEY"
node scripts/benchmark.mjs manifest.json artifacts/benchmark.json
```

The tool submits real jobs, incurs transcription usage, and records verified duration, end-to-end wall time, word errors, and word error rate (edit distance divided by reference word count). Text is lowercased and punctuation is removed before comparison. It does not evaluate speaker assignment, translation, or punctuation accuracy.

Keep audio and references private. Reports contain sample names and job IDs but no API keys or transcript text. Record sample count and conditions whenever sharing results; measured examples are not a production SLA.

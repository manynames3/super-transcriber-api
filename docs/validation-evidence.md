# Validation Evidence

This file records executed validation checks. Earlier sections are historical baselines; the latest release evidence is below.

| Command | Result |
| --- | --- |
| `npm install` in `lambda/` | Passed. Created `package-lock.json`. Full `npm audit` reports 0 vulnerabilities after dev toolchain updates. |
| `npm run build` in `lambda/` | Passed. TypeScript completed with `tsc --noEmit`. |
| `npm test` in `lambda/` | Passed. 4 test files and 12 tests passed. |
| `npm run bundle` in `lambda/` | Passed. Built zip artifacts for 8 Lambda handlers. |
| `terraform fmt -recursive` | Passed. Reformatted `terraform/main.tf`. |
| `terraform init -backend=false` in `terraform/` | Passed. Installed `hashicorp/aws` provider v5.100.0 and wrote `.terraform.lock.hcl`. |
| `terraform validate` in `terraform/` | Passed. Terraform reported the configuration is valid. |
| `git diff --check` | Passed after initializing the local repository and adding files as intent-to-add. |

## UX Optimization Update

| Command | Result |
| --- | --- |
| `npm run build` in `lambda/` | Passed after reusing the presign `jobId` for transcription jobs. |
| `npm test` in `lambda/` | Passed. 4 test files and 13 tests passed. |
| `npm run bundle` in `lambda/` | Passed. Rebuilt zip artifacts for 8 Lambda handlers. |
| `npm audit` in `lambda/` | Passed with 0 vulnerabilities. |
| `git diff --check` | Passed. |

## Enterprise Architecture Upgrade

| Command | Result |
| --- | --- |
| `npm install` in `lambda/` | Passed. Added SQS, Secrets Manager, and Bedrock Runtime SDK clients. |
| `npm run build` in `lambda/` | Passed after adding queue workers, webhooks, and enrichment handlers. |
| `npm test` in `lambda/` | Passed. 4 test files and 15 tests passed. |
| `npm run bundle` in `lambda/` | Passed. Built zip artifacts for 12 Lambda handlers. |
| `npm install` in `sdk/typescript/` | Passed. Created SDK package lock. |
| `npm run build` in `sdk/typescript/` | Passed. TypeScript SDK compiled successfully. |
| `npm audit` in `lambda/` | Passed with 0 vulnerabilities. |
| `npm audit` in `sdk/typescript/` | Passed with 0 vulnerabilities. |
| `terraform fmt -recursive` | Passed. Reformatted Terraform files. |
| `terraform init -backend=false` in `terraform/` | Passed. Reused locked AWS provider. |
| `terraform validate` in `terraform/` | Passed. Terraform reported the configuration is valid. |
| `git diff --check` | Passed. |

## Monetized Product Update

| Command | Result |
| --- | --- |
| `npm install stripe` in `lambda/` | Passed. Added Stripe SDK. |
| `npm run build` in `lambda/` | Passed after adding checkout, claim, webhook, account, and billing portal handlers. |
| `npm test` in `lambda/` | Passed. 4 test files and 16 tests passed. |
| `npm run bundle` in `lambda/` | Passed. Built zip artifacts for 17 Lambda handlers. |
| `npm run build` in `sdk/typescript/` | Passed. SDK compiled with billing helpers. |
| `npm audit` in `lambda/` | Passed with 0 vulnerabilities. |
| `npm audit` in `sdk/typescript/` | Passed with 0 vulnerabilities. |
| `terraform fmt -check -recursive` | Passed. |
| `terraform init -backend=false` in `terraform/` | Passed. Reused locked AWS provider. |
| `terraform validate` in `terraform/` | Passed. Terraform reported the configuration is valid. |
| `git diff --check` | Passed. |

Additional hardening in this pass: checkout redirect URLs are optional so API Gateway can be used before a custom domain exists, Stripe subscription updates map plan ids from configured price ids, and abandoned checkout session records use DynamoDB TTL cleanup.

## Version 1.0.0 Release: October 13, 2026

| Check | Observed result |
| --- | --- |
| Lambda `npm ci`, `npm run build`, `npm test` | Passed. 14 files, 47 tests. Includes worker leases, quota settlement, outbox retry, media parsing, key scopes, downloads, purge, webhook safety, and billing receipt/event regression tests. |
| Lambda `npm run bundle` | Passed. 23 handlers bundled for Node.js 24, arm64; deployed through Terraform. |
| Lambda and SDK `npm audit` | Both reported zero vulnerabilities. |
| SDK `npm test` | Passed. Six tests for upload/polling, retries, typed failures, cancellation, and webhook verification. |
| SDK `npm pack` | Passed. Release tarball contains compiled JavaScript, type declarations, package metadata, and documentation. |
| `node scripts/check-contract.mjs` | Passed. OpenAPI matches all 21 Terraform routes; references, operation IDs, and path parameters validated. |
| Terraform initialization and formatting | Passed. AWS provider locked to 6.68.0; native S3 state locking enabled for the hosted stack. |
| `terraform validate`, `terraform test` | Valid configuration; four mock-provider tests passed. Provider deprecation warnings remain for existing DynamoDB key arguments and region-name attributes. |
| Checkov 3.3.28 with `.checkov.yml` | 371 passed, zero failed, zero parsing errors. The documented cost/privacy exceptions are excluded by configuration, not silently treated as passes. |
| `git diff --check` | Passed. |

### Live AWS And Browser Checks

The existing API Gateway ID, DynamoDB table, and media buckets were adopted into encrypted remote Terraform state without deleting or replacing them. Terraform applied the backend updates successfully. `/health` reported version `1.0.0`, billing disabled, and TXT/JSON/SRT/VTT capabilities.

Two synthetic speech samples completed through private upload, durable queue admission, verified media parsing, Amazon Transcribe, EventBridge completion, and transcript retrieval:

| Input | Measured duration | Observed upload-to-completion time | Outputs verified |
| --- | --- | --- | --- |
| MP3 | 6.984 seconds | 23.217 seconds | Nonempty TXT, normalized JSON, SRT, VTT |
| M4A | 6.972 seconds | 7.530 seconds | Nonempty TXT, normalized JSON, SRT, VTT |

The caller supplied an incorrect one-second duration hint. Usage still recorded 14 whole seconds for the two samples, zero reserved seconds, and zero active jobs after completion. Separate live assertions verified cross-customer denial, read-only scope enforcement, rotation/revocation, rejection of audio above a one-second account limit, and release of failed-job reservations. A retained job from an interrupted worker attempt was replayed successfully, then permanently purged after its upload URL expired: deletion returned 204 and subsequent retrieval returned 404.

The deployed Cloudflare account page connected to the live API, displayed the completed jobs and usage, downloaded a TXT attachment, and disconnected successfully. DOM/layout checks at 1440px and 390px widths found no page-level horizontal overflow; compact section headings consistently measured 20px. API keys were not stored in localStorage. Browser screenshot capture was unavailable, so no screenshot-based visual verification is claimed.

### Boundaries Of This Evidence

These are small synthetic smoke tests, not a load test, accuracy benchmark, SLA, or production-traffic claim. Stripe recovery and subscription logic have mocked regression coverage; live payments remain untested and disabled until Stripe secret references and price IDs are configured. Bedrock enrichment is disabled and was not invoked. Source URL ingestion intentionally returns 501. The sub-$3 idle budget is a design target, not a measured monthly bill.

## Version 1.0.1 Security Follow-Up

The first release's successful CodeQL workflow still reported findings, so its findings were reviewed separately from the workflow status. The SDK now validates URLs with the native URL parser and trims trailing slashes without a backtracking regular expression. Test mocks compare complete origins rather than host prefixes. Subtitle cue text escapes ampersands and angle brackets as literal text, with regression coverage for markup, malformed comments, and cue-like content.

The API-key hashing alert was dismissed as a documented false positive: the verifier hashes a CSPRNG-generated 256-bit secret, not a human password. SHA-256 remains the specified API-key storage design; no password authentication is implemented. No security rule was disabled globally.

Local verification passed with 48 backend tests and eight SDK tests. Bundling also handles filesystem paths containing spaces through Node's standard file-URL conversion.

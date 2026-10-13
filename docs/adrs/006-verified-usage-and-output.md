# 006: Verify Media Before Metering And Expose Portable Output

## Status

Accepted.

## Context

Caller-provided audio duration can undercount consumption, and reserving the maximum duration overcounts short recordings. Developers also need text files and subtitles rather than a provider-specific JSON payload.

## Decision

Seal the submitted S3 object by its accepted ETag, verify duration with music-metadata in a leased worker, and reserve rounded-up seconds before calling Transcribe. Count concurrency separately from calendar-month usage; settle successful consumption or failed-job refunds transactionally. Preserve the raw output and expose authenticated TXT, normalized JSON, SRT, and VTT downloads.

## Consequences

Large media avoids the API request timeout and cannot be changed through the original upload URL once sealed. Invalid media or monthly quota failure can occur after a 202 response. Temporary disk is cleaned after parsing, and sealed copies use the upload lifecycle. Metadata parsing adds active-job processing cost; it adds no fixed idle service. Subtitle/speaker output reflects Transcribe's results and is not a guaranteed diarization accuracy claim.

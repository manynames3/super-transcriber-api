import type { EventBridgeEvent } from "aws-lambda";
import { completeTranscription } from "../shared/completion.js";

export async function handler(
  event: EventBridgeEvent<
    "Transcribe Job State Change",
    { TranscriptionJobName?: string }
  >,
): Promise<void> {
  if (event.detail.TranscriptionJobName)
    await completeTranscription(event.detail.TranscriptionJobName);
}

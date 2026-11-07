import type { ResponseInputItem, ResponsesPayload } from "~/lib/types/responses"

import { decodeMessagesCompaction } from "./messages-translation"

const MESSAGES_COMPACTION_REPLAY_PROMPT =
  "The previous conversation was compacted. Continue from this handoff summary:\n\n"

const getInputItemType = (item: ResponseInputItem): string | undefined =>
  (
    typeof item === "object"
    && item !== null
    && "type" in item
    && typeof item.type === "string"
  ) ?
    item.type
  : undefined

/**
 * Messages fallback compactions are locally encoded summaries, not upstream
 * Responses ciphertext. Replay the latest summary as a developer message when
 * moving back to a native Responses backend, while retaining Responses Lite
 * tool declarations that may have appeared before the compaction carrier.
 */
export const replayMessagesCompactionForNativeResponses = (
  payload: ResponsesPayload,
): boolean => {
  if (!Array.isArray(payload.input)) return false

  const additionalTools = payload.input.filter(
    (item) => getInputItemType(item) === "additional_tools",
  )

  for (let index = payload.input.length - 1; index >= 0; index -= 1) {
    const item = payload.input[index]
    if (
      typeof item !== "object"
      || item === null
      || !("type" in item)
      || item.type !== "compaction"
      || !("encrypted_content" in item)
      || typeof item.encrypted_content !== "string"
    ) {
      continue
    }

    const summary = decodeMessagesCompaction(item.encrypted_content)
    if (!summary) continue

    const suffix = payload.input
      .slice(index + 1)
      .filter((inputItem) => getInputItemType(inputItem) !== "additional_tools")
    payload.input = [
      {
        content: `${MESSAGES_COMPACTION_REPLAY_PROMPT}${summary}`,
        role: "developer",
        type: "message",
      },
      ...additionalTools,
      ...suffix,
    ]
    return true
  }

  return false
}

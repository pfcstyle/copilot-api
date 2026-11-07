import type {
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponsesResult,
  ResponseStreamEvent,
} from "~/lib/types/responses"

export type CodexResponseMessagePhase = "commentary" | "final_answer"

export interface ResponsePhaseStreamItem<T> {
  event: ResponseStreamEvent | null
  value: T
}

const CLIENT_TOOL_CALL_TYPES = new Set([
  "custom_tool_call",
  "function_call",
  "tool_search_call",
])

const isClientToolCall = (item: ResponseOutputItem): boolean =>
  CLIENT_TOOL_CALL_TYPES.has(item.type)

const hasClientToolCall = (response: ResponsesResult): boolean =>
  response.output.some(isClientToolCall)

const getResponsePhase = (
  response: ResponsesResult,
): CodexResponseMessagePhase =>
  response.status === "completed" && !hasClientToolCall(response) ?
    "final_answer"
  : "commentary"

const normalizeMessage = (
  message: ResponseOutputMessage,
  phase: CodexResponseMessagePhase,
): ResponseOutputMessage => (message.phase ? message : { ...message, phase })

const normalizeOutput = (
  output: Array<ResponseOutputItem>,
  phase: CodexResponseMessagePhase,
): Array<ResponseOutputItem> => {
  let changed = false
  const normalized = output.map((item) => {
    if (item.type !== "message" || item.phase) return item
    changed = true
    return normalizeMessage(item, phase)
  })
  return changed ? normalized : output
}

export const normalizeResponseMessagePhases = (
  response: ResponsesResult,
  phase = getResponsePhase(response),
): ResponsesResult => {
  const output = normalizeOutput(response.output, phase)
  return output === response.output ? response : { ...response, output }
}

const getEventResponse = (
  event: ResponseStreamEvent,
): ResponsesResult | null =>
  "response" in event && event.response ? event.response : null

const eventHasClientToolCall = (event: ResponseStreamEvent): boolean => {
  if (
    event.type === "response.function_call_arguments.delta"
    || event.type === "response.function_call_arguments.done"
    || event.type === "response.custom_tool_call_input.delta"
    || event.type === "response.custom_tool_call_input.done"
  ) {
    return true
  }

  if (
    (event.type === "response.output_item.added"
      || event.type === "response.output_item.done")
    && isClientToolCall(event.item)
  ) {
    return true
  }

  const response = getEventResponse(event)
  return response ? hasClientToolCall(response) : false
}

const eventHasUnphasedMessage = (event: ResponseStreamEvent): boolean => {
  if (
    (event.type === "response.output_item.added"
      || event.type === "response.output_item.done")
    && event.item.type === "message"
    && !event.item.phase
  ) {
    return true
  }

  const response = getEventResponse(event)
  return (
    response?.output.some((item) => item.type === "message" && !item.phase)
    ?? false
  )
}

const normalizeStreamEvent = (
  event: ResponseStreamEvent,
  phase: CodexResponseMessagePhase,
): ResponseStreamEvent => {
  if (
    (event.type === "response.output_item.added"
      || event.type === "response.output_item.done")
    && event.item.type === "message"
  ) {
    const item = normalizeMessage(event.item, phase)
    return item === event.item ? event : { ...event, item }
  }

  const response = getEventResponse(event)
  if (!response) return event

  const normalizedResponse = normalizeResponseMessagePhases(response, phase)
  return normalizedResponse === response ? event : (
      ({ ...event, response: normalizedResponse } as ResponseStreamEvent)
    )
}

/**
 * Delay an undecided assistant message until the response either emits a
 * client tool call or reaches a terminal event. Every buffered event is then
 * released in its original order with only missing message phases filled.
 */
export async function* normalizeResponsePhaseStreamItems<T>(
  source: AsyncIterable<ResponsePhaseStreamItem<T>>,
): AsyncGenerator<ResponsePhaseStreamItem<T>> {
  let phase: CodexResponseMessagePhase | null = null
  let buffered: Array<ResponsePhaseStreamItem<T>> = []

  const flush = function* (): Generator<ResponsePhaseStreamItem<T>> {
    if (!phase) return
    for (const item of buffered) {
      yield {
        ...item,
        event: item.event ? normalizeStreamEvent(item.event, phase) : null,
      }
    }
    buffered = []
  }

  for await (const item of source) {
    const { event } = item
    if (!event) {
      if (buffered.length > 0) {
        buffered.push(item)
      } else {
        yield item
      }
      continue
    }

    if (!phase && eventHasClientToolCall(event)) {
      phase = "commentary"
    }

    if (!phase) {
      if (event.type === "response.completed") {
        phase = "final_answer"
      } else if (
        event.type === "response.incomplete"
        || event.type === "response.failed"
        || event.type === "error"
      ) {
        phase = "commentary"
      }
    }

    if (phase) {
      yield* flush()
      yield { ...item, event: normalizeStreamEvent(event, phase) }
      continue
    }

    if (buffered.length > 0 || eventHasUnphasedMessage(event)) {
      buffered.push(item)
      continue
    }

    yield item
  }

  phase ??= "commentary"
  yield* flush()
}

export async function* normalizeResponsePhaseEvents(
  source: AsyncIterable<ResponseStreamEvent>,
): AsyncGenerator<ResponseStreamEvent> {
  const items = (async function* () {
    for await (const event of source) {
      yield { event, value: event }
    }
  })()

  for await (const item of normalizeResponsePhaseStreamItems(items)) {
    if (item.event) yield item.event
  }
}

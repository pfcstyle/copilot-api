import { events } from "fetch-event-stream"
import type { Context } from "hono"
import { streamSSE } from "hono/streaming"

import { COMPACT_REQUEST } from "~/lib/compact"
import { createHandlerLogger, debugJson } from "~/lib/logger"
import type { SubagentMarker } from "~/lib/subagent"
import type { AnthropicResponse } from "~/lib/types/anthropic"
import type { ResponsesPayload } from "~/lib/types/responses"
import { handleCompletionPayload } from "~/routes/messages/handler"
import {
  isCodexUserAgent,
  shouldInjectMessagesToolCallTips,
} from "~/routes/models/codex-models"

import {
  responsesResultToStreamEvents,
  translateMessagesStream,
} from "./messages-stream-translation"
import {
  ResponsesMessagesTranslationError,
  translateAnthropicToResponses,
  translateResponsesToMessages,
  type MessagesResponseTranslationContext,
} from "./messages-translation"
import {
  normalizeResponseMessagePhases,
  normalizeResponsePhaseEvents,
} from "./phase-normalization"

const logger = createHandlerLogger("responses-messages-handler")

export const responsesMessagesDependencies = {
  handleCompletionPayload,
}

export async function handleResponsesViaMessages(
  c: Context,
  options: {
    payload: ResponsesPayload
    publicModel: string
    targetModel: string
    subagentMarker?: SubagentMarker | null
    requestId?: string
    sessionId?: string
  },
): Promise<Response> {
  try {
    const normalizePhases = isCodexUserAgent(c.req.header("user-agent"))
    const translation = translateResponsesToMessages(
      { ...options.payload, model: options.publicModel },
      {
        model: options.targetModel,
        publicModel: options.publicModel,
        toolCallTips: shouldInjectMessagesToolCallTips(
          c.req.header("user-agent"),
          options.targetModel,
        ),
      },
    )
    const context: MessagesResponseTranslationContext = translation

    debugJson(logger, "Translated Messages request:", {
      payload: translation.messagesPayload,
      publicModel: options.publicModel,
      targetModel: options.targetModel,
      userAgent: c.req.header("user-agent") ?? "",
    })

    const messagesResponse =
      await responsesMessagesDependencies.handleCompletionPayload(
        c,
        translation.messagesPayload,
        {
          compactType: translation.compaction ? COMPACT_REQUEST : undefined,
          skipClaudeAutoModel: true,
          skipModelMapping: true,
          skipWebSearch: true,
          usageEndpoint: "responses",
          subagentMarker: options.subagentMarker,
          requestId: options.requestId,
          sessionId: options.sessionId,
        },
      )

    if (!messagesResponse.ok) {
      return messagesResponse
    }

    const contentType = messagesResponse.headers.get("content-type") ?? ""
    if (contentType.includes("text/event-stream")) {
      if (!translation.messagesPayload.stream) {
        throw new ResponsesMessagesTranslationError(
          "Messages API returned a stream for a non-streaming Responses request",
          502,
        )
      }
      return streamTranslatedMessagesEvents(
        c,
        messagesResponse,
        context,
        normalizePhases,
      )
    }

    const body = await messagesResponse.json()
    if (!isAnthropicResponse(body)) {
      throw new ResponsesMessagesTranslationError(
        "Messages API returned an invalid response body",
        502,
      )
    }
    const translatedResult = translateAnthropicToResponses(body, context)
    const result =
      normalizePhases ?
        normalizeResponseMessagePhases(translatedResult)
      : translatedResult
    debugJson(logger, "Translated Responses result:", result)

    if (!translation.messagesPayload.stream) {
      return c.json(result)
    }
    return streamSSE(c, async (stream) => {
      for (const event of responsesResultToStreamEvents(result)) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    })
  } catch (error) {
    if (error instanceof ResponsesMessagesTranslationError) {
      return c.json(
        {
          error: {
            message: error.message,
            type: "invalid_request_error",
          },
        },
        error.status as 400 | 502,
      )
    }
    throw error
  }
}

function streamTranslatedMessagesEvents(
  c: Context,
  response: Response,
  context: MessagesResponseTranslationContext,
  normalizePhases: boolean,
): Response {
  return streamSSE(c, async (stream) => {
    const translatedEvents = translateMessagesStream(events(response), context)
    const responseEvents =
      normalizePhases ?
        normalizeResponsePhaseEvents(translatedEvents)
      : translatedEvents
    for await (const event of responseEvents) {
      debugJson(logger, "Translated Responses stream event:", event)
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      })
    }
  })
}

function isAnthropicResponse(value: unknown): value is AnthropicResponse {
  return (
    typeof value === "object"
    && value !== null
    && "type" in value
    && value.type === "message"
    && "content" in value
    && Array.isArray(value.content)
  )
}

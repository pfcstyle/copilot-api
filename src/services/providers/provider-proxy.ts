import consola from "consola"
import {
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from "undici"

import type { ResolvedProviderConfig } from "~/lib/config"
import { getProviderApiPathPrefix } from "~/lib/config"
import { createTimeoutDispatcher } from "~/lib/timeout-dispatcher"
import type { AnthropicMessagesPayload } from "~/lib/types/anthropic"
import type { ChatCompletionsPayload } from "~/lib/types/chat-completions"
import type { ResponsesPayload } from "~/lib/types/responses"
import { getResponsesTransportConfig } from "~/lib/config"
import { fetchResponsesWithLifecycle } from "~/services/responses-http"
import { writeProviderDebugLog } from "~/lib/provider-debug-log"

const SHARED_FORWARDABLE_HEADERS = ["accept", "user-agent"] as const

/**
 * Upstream URL for a provider endpoint. The path prefix depends on the
 * provider type so Ark ("/v3") and OpenAI-style providers ("/v1") work from
 * a prefix-free baseUrl. A baseUrl that already ends with the provider's path
 * prefix (for example, Aliyun Token Plan's ".../compatible-mode/v1") is also
 * accepted without duplicating that prefix.
 */
function buildProviderUpstreamUrl(
  providerConfig: ResolvedProviderConfig,
  endpointPath: string,
): string {
  const prefix = getProviderApiPathPrefix(providerConfig.type)
  const baseUrl = providerConfig.baseUrl.replace(/\/+$/u, "")
  const hasPrefix = prefix.length > 0 && baseUrl.endsWith(prefix)
  return `${baseUrl}${hasPrefix ? "" : prefix}${endpointPath}`
}

const ANTHROPIC_FORWARDABLE_HEADERS = [
  "anthropic-version",
  "anthropic-beta",
] as const

const STRIPPED_RESPONSE_HEADERS = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const

export function buildProviderUpstreamHeaders(
  providerConfig: ResolvedProviderConfig,
  requestHeaders: Headers,
): Record<string, string> {
  const authHeaders: Record<string, string> = {}
  if (providerConfig.authType === "x-api-key") {
    authHeaders["x-api-key"] = providerConfig.apiKey
  } else {
    authHeaders.authorization = `Bearer ${providerConfig.apiKey}`
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...authHeaders,
  }

  for (const headerName of SHARED_FORWARDABLE_HEADERS) {
    const headerValue = requestHeaders.get(headerName)
    if (headerValue) {
      headers[headerName] = headerValue
    }
  }

  if (providerConfig.type !== "anthropic") {
    return headers
  }

  for (const headerName of ANTHROPIC_FORWARDABLE_HEADERS) {
    const headerValue = requestHeaders.get(headerName)
    if (headerValue) {
      headers[headerName] = headerValue
    }
  }

  return headers
}

export function createProviderProxyResponse(
  upstreamResponse: Response,
  body?: ReadableStream<Uint8Array> | null,
): Response {
  const headers = new Headers(upstreamResponse.headers)

  for (const headerName of STRIPPED_RESPONSE_HEADERS) {
    headers.delete(headerName)
  }

  return new Response(body ?? upstreamResponse.body, {
    headers,
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
  })
}

export async function forwardProviderMessages(
  providerConfig: ResolvedProviderConfig,
  payload: AnthropicMessagesPayload,
  requestHeaders: Headers,
): Promise<Response> {
  consola.log(`<-- model: ${payload.model}`)
  const upstreamUrl = buildProviderUpstreamUrl(providerConfig, "/messages")
  const response = await fetch(upstreamUrl, {
    method: "POST",
    headers: buildProviderUpstreamHeaders(providerConfig, requestHeaders),
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const errorBody = await response
      .clone()
      .text()
      .catch(() => "<unreadable>")
    writeProviderDebugLog("provider_messages_upstream_error", {
      status: response.status,
      url: upstreamUrl,
      model: payload.model,
      max_tokens: payload.max_tokens,
      message_count: payload.messages?.length,
      system_chars:
        typeof payload.system === "string" ? payload.system.length : undefined,
      error_body: errorBody.slice(0, 2000),
    })
  }
  return response
}

export async function forwardProviderChatCompletions(
  providerConfig: ResolvedProviderConfig,
  payload: ChatCompletionsPayload,
  requestHeaders: Headers,
): Promise<Response> {
  consola.log(`<-- model: ${payload.model}`)
  return await fetch(
    buildProviderUpstreamUrl(providerConfig, "/chat/completions"),
    {
      method: "POST",
      headers: buildProviderUpstreamHeaders(providerConfig, requestHeaders),
      body: JSON.stringify(payload),
    },
  )
}

export async function forwardProviderResponses(
  providerConfig: ResolvedProviderConfig,
  payload: ResponsesPayload,
  requestHeaders: Headers,
  options: { signal?: AbortSignal } = {},
): Promise<Response> {
  consola.log(`<-- model: ${payload.model}`)
  const transportConfig = getResponsesTransportConfig()
  const upstreamUrl = buildProviderUpstreamUrl(providerConfig, "/responses")
  const response = await fetchResponsesWithLifecycle(
    upstreamUrl,
    {
      method: "POST",
      headers: buildProviderUpstreamHeaders(providerConfig, requestHeaders),
      body: JSON.stringify(payload),
    },
    {
      headersTimeoutMs: transportConfig.headersTimeoutMs,
      signal: options.signal,
      streamInactivityTimeoutMs: transportConfig.streamInactivityTimeoutMs,
    },
  )
  if (!response.ok) {
    const errorBody = await response
      .clone()
      .text()
      .catch(() => "<unreadable>")
    writeProviderDebugLog("provider_responses_upstream_error", {
      status: response.status,
      url: upstreamUrl,
      model: payload.model,
      max_output_tokens: payload.max_output_tokens,
      reasoning: payload.reasoning ?? null,
      store: payload.store,
      stream: payload.stream,
      input_items: Array.isArray(payload.input) ? payload.input.length : null,
      input_item_shapes: getResponsesInputItemShapes(payload),
      error_body: errorBody.slice(0, 2000),
    })
    consola.error(
      `[provider-responses] upstream ${response.status} ${upstreamUrl} model=${payload.model} `
        + `max_output_tokens=${String(payload.max_output_tokens)} `
        + `reasoning=${JSON.stringify(payload.reasoning ?? null)} `
        + `store=${String(payload.store)} stream=${String(payload.stream)} `
        + `input_items=${Array.isArray(payload.input) ? payload.input.length : "n/a"} `
        + `body=${errorBody.slice(0, 1000)}`,
    )
  }
  return response
}

const getResponsesInputItemShapes = (
  payload: ResponsesPayload,
): Array<{
  type: string | null
  fields: Array<string>
}> | null => {
  if (!Array.isArray(payload.input)) {
    return null
  }

  return payload.input.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { type: null, fields: [] }
    }

    const record = item as Record<string, unknown>
    return {
      type: typeof record.type === "string" ? record.type : null,
      fields: Object.keys(record).sort(),
    }
  })
}

const PROVIDER_MODELS_TIMEOUT_MS = 15_000

export async function forwardProviderModels(
  providerConfig: ResolvedProviderConfig,
  requestHeaders: Headers,
): Promise<Response> {
  return await fetch(buildProviderUpstreamUrl(providerConfig, "/models"), {
    method: "GET",
    headers: buildProviderUpstreamHeaders(providerConfig, requestHeaders),
    signal: AbortSignal.timeout(PROVIDER_MODELS_TIMEOUT_MS),
  })
}

/** Align with Codex images: long-running generation/edits need a generous cap. */
const PROVIDER_IMAGES_TIMEOUT_MS = 15 * 60 * 1000

const providerImagesDispatcher = createTimeoutDispatcher(
  PROVIDER_IMAGES_TIMEOUT_MS,
)

function resolveProviderRequestUrl(
  providerConfig: ResolvedProviderConfig,
  requestUrl: string,
  path: string,
): string {
  const upstreamUrl = new URL(buildProviderUpstreamUrl(providerConfig, path))
  upstreamUrl.search = new URL(requestUrl, "http://localhost").search
  return upstreamUrl.toString()
}

export async function forwardProviderAlphaSearch(
  providerConfig: ResolvedProviderConfig,
  request: Request,
): Promise<Response> {
  const headers = buildProviderUpstreamHeaders(providerConfig, request.headers)
  const body = await request.arrayBuffer()

  return await fetch(
    resolveProviderRequestUrl(providerConfig, request.url, "/alpha/search"),
    {
      method: "POST",
      headers,
      body,
    },
  )
}

export async function forwardProviderImages(
  providerConfig: ResolvedProviderConfig,
  request: Request,
  operation: "generations" | "edits",
): Promise<Response> {
  const headers = buildProviderUpstreamHeaders(providerConfig, request.headers)
  const contentType = request.headers.get("content-type")
  if (contentType) {
    headers["content-type"] = contentType
  } else if (operation === "edits") {
    delete headers["content-type"]
  }

  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body: request.body,
    duplex: "half",
    signal: AbortSignal.timeout(PROVIDER_IMAGES_TIMEOUT_MS),
  }

  const upstreamUrl = resolveProviderRequestUrl(
    providerConfig,
    request.url,
    `/images/${operation}`,
  )

  if (typeof Bun !== "undefined") {
    return await fetch(upstreamUrl, init)
  }

  // Node's global fetch keeps Undici's shorter default headers/body timeouts.
  // Use an explicit dispatcher so the documented 15-minute cap applies there.
  return (await undiciFetch(upstreamUrl, {
    ...init,
    dispatcher: providerImagesDispatcher,
  } as unknown as UndiciRequestInit)) as unknown as Response
}

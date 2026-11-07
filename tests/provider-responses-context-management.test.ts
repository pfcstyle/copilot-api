import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Hono } from "hono"

import type { ResolvedProviderConfig } from "~/lib/config"
import { state } from "~/lib/state"
import type { ResponsesResult } from "~/lib/types/responses"

let providerConfig: ResolvedProviderConfig | null = null

const { closeUsageStore } = await import("~/lib/token-usage")
const { responsesRoutes } = await import("~/routes/responses/route")
const { providerResponsesRoutes } = await import(
  "~/routes/provider/responses/route"
)
const { providerMessagesHandlerDependencies } = await import(
  "~/routes/provider/messages/handler"
)
const { providerResponsesHandlerDependencies } = await import(
  "~/routes/provider/responses/handler"
)
const { responsesHandlerDependencies } = await import(
  "~/routes/responses/handler"
)
const { responsesUtilsDependencies } = await import("~/routes/responses/utils")
const { decodeMessagesCompaction, encodeMessagesCompaction } = await import(
  "~/routes/responses/messages-translation"
)

const defaultProviderMessagesHandlerDependencies = {
  ...providerMessagesHandlerDependencies,
}
const defaultProviderResponsesHandlerDependencies = {
  ...providerResponsesHandlerDependencies,
}
const defaultResponsesHandlerDependencies = { ...responsesHandlerDependencies }
const defaultResponsesUtilsDependencies = { ...responsesUtilsDependencies }
const originalFetch = globalThis.fetch

const DB_PATH_ENV = "COPILOT_API_SQLITE_DB_PATH"

const createResponsesResult = (model: string): ResponsesResult => ({
  created_at: 0,
  error: null,
  id: "resp-test",
  incomplete_details: null,
  instructions: null,
  metadata: null,
  model,
  object: "response",
  output: [],
  output_text: "",
  parallel_tool_calls: false,
  status: "completed",
  temperature: null,
  tool_choice: "auto",
  tools: [],
  top_p: null,
  usage: null,
})

const parseJsonRequestBody = (body: unknown): unknown => {
  if (typeof body !== "string") {
    throw new Error("Expected JSON string request body")
  }

  return JSON.parse(body) as unknown
}

const defaultFetchImplementation = (
  _url: string | URL | Request,
  init?: RequestInit,
) => {
  const body = parseJsonRequestBody(init?.body) as { model: string }
  return Promise.resolve(
    new Response(JSON.stringify(createResponsesResult(body.model)), {
      headers: {
        "content-type": "application/json",
      },
    }),
  )
}

const fetchMock = mock(defaultFetchImplementation)

const createApp = () => {
  const app = new Hono()
  app.route("/v1/responses", responsesRoutes)
  app.route("/:provider/v1/responses", providerResponsesRoutes)
  return app
}

beforeEach(async () => {
  process.env[DB_PATH_ENV] = ":memory:"
  await closeUsageStore()

  providerConfig = {
    apiKey: "provider-key",
    authType: "authorization",
    baseUrl: "https://openai-responses.example",
    models: {
      "gpt-test": {},
    },
    name: "openai",
    type: "openai-responses",
  }

  const resolveProviderConfig = () => Promise.resolve(providerConfig)
  providerMessagesHandlerDependencies.resolveProviderConfig =
    resolveProviderConfig
  providerResponsesHandlerDependencies.resolveProviderConfig =
    resolveProviderConfig
  responsesHandlerDependencies.resolveMappedModel = (model) => model
  responsesUtilsDependencies.getModelResponsesApiCompactThreshold = () =>
    undefined
  responsesUtilsDependencies.isContextManagementEnabledForMessages = () => true
  responsesUtilsDependencies.isContextManagementEnabledForResponses = () =>
    false
  fetchMock.mockImplementation(defaultFetchImplementation)
  fetchMock.mockClear()
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch
})

afterEach(async () => {
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch
  providerConfig = null
  Object.assign(
    providerMessagesHandlerDependencies,
    defaultProviderMessagesHandlerDependencies,
  )
  Object.assign(
    providerResponsesHandlerDependencies,
    defaultProviderResponsesHandlerDependencies,
  )
  Object.assign(
    responsesHandlerDependencies,
    defaultResponsesHandlerDependencies,
  )
  Object.assign(responsesUtilsDependencies, defaultResponsesUtilsDependencies)

  await closeUsageStore()
  Reflect.deleteProperty(process.env, DB_PATH_ENV)
})

describe("provider Responses context management", () => {
  test("drops an unlinked tool output before forwarding to a provider", async () => {
    const app = createApp()
    const response = await app.request("/v1/responses", {
      body: JSON.stringify({
        input: [
          { content: "Continue", role: "user", type: "message" },
          {
            id: "fco_orphaned",
            internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
            name: "send_message_to_thread",
            output: "Continue",
            type: "function_call_output",
          },
        ],
        model: "openai/gpt-test",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      input: Array<unknown>
    }
    expect(body.input).toEqual([
      { content: "Continue", role: "user", type: "message" },
    ])
  })

  test("removes Codex-only input metadata before forwarding to a provider", async () => {
    const app = createApp()
    const response = await app.request("/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: "Continue",
            internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
            phase: "commentary",
            role: "user",
            type: "message",
          },
          {
            encrypted_content: "not-portable",
            id: "reasoning-1",
            summary: [],
            type: "reasoning",
          },
        ],
        model: "openai/gpt-test",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      input: Array<unknown>
    }
    expect(body.input).toEqual([
      { content: "Continue", role: "user", type: "message" },
    ])
  })

  test("does not add context management or compact provider Responses input by default", async () => {
    const app = createApp()
    const response = await app.request("/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: "older",
            role: "user",
          },
          {
            encrypted_content: "cipher",
            id: "compaction-1",
            type: "compaction",
          },
          {
            content: "latest",
            role: "user",
          },
        ],
        model: "openai/gpt-test",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      context_management?: unknown
      input: Array<unknown>
    }

    expect(body.context_management).toBeUndefined()
    expect(body.input).toHaveLength(3)
  })

  test("adds context management and keeps only the latest compaction carrier when enabled", async () => {
    responsesUtilsDependencies.isContextManagementEnabledForResponses = () =>
      true

    const app = createApp()
    const response = await app.request("/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: "older",
            role: "user",
          },
          {
            encrypted_content: "cipher",
            id: "compaction-1",
            type: "compaction",
          },
          {
            content: "latest",
            role: "user",
          },
        ],
        model: "openai/gpt-test",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      context_management?: unknown
      input: Array<Record<string, unknown>>
    }

    expect(body.context_management).toEqual([
      {
        compact_threshold: 160000,
        type: "compaction",
      },
    ])
    expect(body.input).toEqual([
      {
        encrypted_content: "cipher",
        id: "compaction-1",
        type: "compaction",
      },
      {
        content: "latest",
        role: "user",
      },
    ])
  })

  test("does not add context management for non-GPT Responses models", async () => {
    responsesUtilsDependencies.isContextManagementEnabledForResponses = () =>
      true

    const app = createApp()
    const response = await app.request("/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: "older",
            role: "user",
          },
          {
            encrypted_content: "cipher",
            id: "compaction-1",
            type: "compaction",
          },
          {
            content: "latest",
            role: "user",
          },
        ],
        model: "openai/grok-4.5",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      context_management?: unknown
      input: Array<unknown>
    }

    expect(body.context_management).toBeUndefined()
    expect(body.input).toHaveLength(3)
  })

  test("normalizes Grok effort across the Codex Messages fallback", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://openai-responses.example",
      models: {
        "grok-4.5": {},
      },
      name: "opencode-go",
      type: "openai-responses",
      codexResponsesMode: "messages",
    }

    const app = createApp()
    const response = await app.request("/opencode-go/v1/responses", {
      body: JSON.stringify({
        input: "hello",
        model: "grok-4.5",
        reasoning: { effort: "max" },
      }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      reasoning?: { effort?: string }
    }
    expect(body.reasoning?.effort).toBe("high")
  })

  for (const effort of ["none", "low", "max", "turbo"] as const) {
    test(`preserves ${effort} when provider capabilities are unknown`, async () => {
      const app = createApp()
      const response = await app.request("/openai/v1/responses", {
        body: JSON.stringify({
          input: "hello",
          model: "gpt-test",
          reasoning: { effort },
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      })

      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      const [, init] = fetchMock.mock.calls[0]
      const body = parseJsonRequestBody((init as RequestInit).body) as {
        reasoning?: { effort?: string }
      }
      expect(body.reasoning?.effort).toBe(effort)
    })
  }

  test("disables context management for gpt-5.6 models even when responses is enabled", async () => {
    responsesUtilsDependencies.isContextManagementEnabledForResponses = () =>
      true

    const app = createApp()
    const response = await app.request("/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: "older",
            role: "user",
          },
          {
            encrypted_content: "cipher",
            id: "compaction-1",
            type: "compaction",
          },
          {
            content: "latest",
            role: "user",
          },
        ],
        model: "openai/gpt-5.6-sol",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      context_management?: unknown
      input: Array<unknown>
    }

    expect(body.context_management).toBeUndefined()
    expect(body.input).toHaveLength(3)
  })

  test("disables context management for gpt-6 models even when responses is enabled", async () => {
    responsesUtilsDependencies.isContextManagementEnabledForResponses = () =>
      true

    const app = createApp()
    const response = await app.request("/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: "older",
            role: "user",
          },
          {
            encrypted_content: "cipher",
            id: "compaction-1",
            type: "compaction",
          },
          {
            content: "latest",
            role: "user",
          },
        ],
        model: "openai/gpt-6",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      context_management?: unknown
      input: Array<unknown>
    }

    expect(body.context_management).toBeUndefined()
    expect(body.input).toHaveLength(3)
  })

  test("supports the provider-scoped responses route", async () => {
    const app = createApp()
    const response = await app.request("/openai/v1/responses", {
      body: JSON.stringify({
        input: "hello",
        model: "gpt-test",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://openai-responses.example/v1/responses",
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      model: string
    }
    expect(body.model).toBe("gpt-test")
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  test("downgrades none reasoning for Ark Coding Plan models", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://ark.example/api/coding",
      models: {
        "kimi-k2.7-code": {},
      },
      name: "doubao",
      type: "ark-doubao",
    }

    const response = await createApp().request("/doubao/v1/responses", {
      body: JSON.stringify({
        input: "hello",
        model: "kimi-k2.7-code",
        reasoning: { effort: "none" },
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://ark.example/api/coding/v3/responses",
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      reasoning?: { effort?: string }
    }
    expect(body.reasoning?.effort).toBe("low")
  })

  test("forwards the selected medium reasoning effort for Ark Coding Plan models", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://ark.example/api/coding",
      models: {
        "kimi-k2.7-code": {},
      },
      name: "doubao",
      type: "ark-doubao",
    }

    const response = await createApp().request("/doubao/v1/responses", {
      body: JSON.stringify({
        input: "hello",
        model: "kimi-k2.7-code",
        reasoning: { effort: "medium" },
      }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://ark.example/api/coding/v3/responses",
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      reasoning?: { effort?: string }
    }
    expect(body.reasoning?.effort).toBe("medium")
  })

  test("forwards Aliyun Token Plan Responses without duplicating /v1", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl:
        "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      models: {
        "kimi-k2.7-code": {},
      },
      name: "ali",
      type: "openai-responses",
    }

    const response = await createApp().request("/ali/v1/responses", {
      body: JSON.stringify({
        input: "hello",
        model: "kimi-k2.7-code",
        reasoning: { effort: "medium" },
      }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses",
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      reasoning?: { effort?: string }
    }
    expect(body.reasoning?.effort).toBe("medium")
  })

  test("directly preserves Responses Lite tools for provider and alias routes", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl:
        "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      models: { "glm-5.3": {} },
      name: "ali",
      type: "openai-responses",
    }

    for (const [path, model] of [
      ["/ali/v1/responses", "glm-5.3"],
      ["/v1/responses", "ali/glm-5.3"],
    ] as const) {
      const response = await createApp().request(path, {
        body: JSON.stringify({
          input: [
            {
              role: "developer",
              tools: [
                { name: "apply_patch", type: "custom" },
                {
                  name: "workspace",
                  tools: [
                    {
                      name: "read_file",
                      parameters: { type: "object" },
                      strict: false,
                      type: "function",
                    },
                  ],
                  type: "namespace",
                },
              ],
              type: "additional_tools",
            },
            { content: "Inspect and patch", role: "user", type: "message" },
          ],
          model,
          parallel_tool_calls: false,
          tools: [
            { name: "apply_patch", type: "custom" },
            {
              name: "workspace",
              tools: [
                {
                  name: "read_file",
                  parameters: { type: "object" },
                  strict: false,
                  type: "function",
                },
              ],
              type: "namespace",
            },
          ],
        }),
        headers: {
          "content-type": "application/json",
          "user-agent": "codex-cli/1.0.0",
        },
        method: "POST",
      })

      expect(response.status).toBe(200)
      const [, init] = fetchMock.mock.calls.at(-1)!
      const body = parseJsonRequestBody(init?.body) as {
        input: Array<Record<string, unknown>>
        model: string
        parallel_tool_calls: boolean
        tools: Array<Record<string, unknown>>
      }
      expect(body.model).toBe("glm-5.3")
      expect(body.parallel_tool_calls).toBe(false)
      expect(body.input[0]).toMatchObject({
        role: "developer",
        type: "additional_tools",
      })
      expect(body.tools.map((tool) => tool.type)).toEqual([
        "custom",
        "namespace",
      ])
    }
  })

  test("uses model Responses mode before provider mode", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://openai-responses.example",
      codexResponsesMode: "messages",
      models: {
        direct: { codexResponsesMode: "direct" },
        fallback: { codexResponsesMode: "messages" },
      },
      name: "openai",
      type: "openai-responses",
    }

    const request = (model: string) =>
      createApp().request("/openai/v1/responses", {
        body: JSON.stringify({
          input: [
            {
              role: "developer",
              tools: [{ name: "apply_patch", type: "custom" }],
              type: "additional_tools",
            },
            { content: "Patch it", role: "user", type: "message" },
          ],
          model,
        }),
        headers: {
          "content-type": "application/json",
          "user-agent": "codex-cli/1.0.0",
        },
        method: "POST",
      })

    expect((await request("direct")).status).toBe(200)
    let [, init] = fetchMock.mock.calls.at(-1)!
    let body = parseJsonRequestBody(init?.body) as {
      input: Array<Record<string, unknown>>
    }
    expect(body.input[0]?.type).toBe("additional_tools")

    providerConfig.codexResponsesMode = "direct"
    expect((await request("fallback")).status).toBe(200)
    ;[, init] = fetchMock.mock.calls.at(-1)!
    body = parseJsonRequestBody(init?.body) as {
      input: Array<Record<string, unknown>>
    }
    expect(body.input.some((item) => item.type === "additional_tools")).toBe(
      false,
    )
  })

  test("creates Codex compactions locally for direct third-party Responses providers", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://openai-responses.example",
      codexResponsesMode: "direct",
      models: { "glm-5.3": {} },
      name: "ali",
      type: "openai-responses",
    }
    fetchMock.mockImplementation((_url, init) => {
      const requestBody = parseJsonRequestBody(init?.body) as {
        input: Array<Record<string, unknown>>
        model: string
      }
      expect(
        requestBody.input.some((item) => item.type === "compaction_trigger"),
      ).toBe(false)
      expect(JSON.stringify(requestBody.input)).toContain(
        "CONTEXT CHECKPOINT COMPACTION",
      )

      return Promise.resolve(
        Response.json({
          ...createResponsesResult(requestBody.model),
          output: [
            {
              content: [
                {
                  annotations: [],
                  text: "Current progress and verified next steps",
                  type: "output_text",
                },
              ],
              id: "msg-summary",
              role: "assistant",
              status: "completed",
              type: "message",
            },
          ],
          output_text: "Current progress and verified next steps",
        }),
      )
    })

    for (const [path, model] of [
      ["/ali/v1/responses", "glm-5.3"],
      ["/v1/responses", "ali/glm-5.3"],
    ] as const) {
      const response = await createApp().request(path, {
        body: JSON.stringify({
          input: [
            {
              content: "Implement the feature",
              role: "user",
              type: "message",
            },
            { type: "compaction_trigger" },
          ],
          model,
        }),
        headers: {
          "content-type": "application/json",
          "user-agent": "codex-cli/1.0.0",
        },
        method: "POST",
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as ResponsesResult
      expect(body.output).toHaveLength(1)
      expect(body.output[0]?.type).toBe("compaction")
      if (body.output[0]?.type === "compaction") {
        expect(decodeMessagesCompaction(body.output[0].encrypted_content)).toBe(
          "Current progress and verified next steps",
        )
      }
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("streams local Codex compactions for direct third-party Responses providers", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://openai-responses.example",
      models: { "glm-5.3": {} },
      name: "ali",
      type: "openai-responses",
    }
    const summary = "Streamed progress and next steps"
    fetchMock.mockImplementation((_url, init) => {
      const requestBody = parseJsonRequestBody(init?.body) as {
        input: Array<Record<string, unknown>>
        model: string
        stream?: boolean
      }
      expect(requestBody.stream).toBe(true)
      expect(
        requestBody.input.some((item) => item.type === "compaction_trigger"),
      ).toBe(false)

      const createdResponse = {
        ...createResponsesResult(requestBody.model),
        status: "in_progress",
      }
      const completedResponse = {
        ...createResponsesResult(requestBody.model),
        output: [
          {
            content: [
              {
                annotations: [],
                text: summary,
                type: "output_text",
              },
            ],
            id: "msg-stream-summary",
            role: "assistant",
            status: "completed",
            type: "message",
          },
        ],
        output_text: summary,
      }
      const streamEvents = [
        {
          response: createdResponse,
          sequence_number: 0,
          type: "response.created",
        },
        {
          content_index: 0,
          delta: summary,
          item_id: "msg-stream-summary",
          output_index: 0,
          sequence_number: 1,
          type: "response.output_text.delta",
        },
        {
          response: completedResponse,
          sequence_number: 2,
          type: "response.completed",
        },
      ]

      return Promise.resolve(
        new Response(
          streamEvents
            .map(
              (event) =>
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join("") + "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        ),
      )
    })

    const response = await createApp().request("/ali/v1/responses", {
      body: JSON.stringify({
        input: [
          { content: "Implement the feature", role: "user", type: "message" },
          { type: "compaction_trigger" },
        ],
        model: "glm-5.3",
        stream: true,
      }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const events = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .filter((data) => data !== "[DONE]")
      .map((data) => JSON.parse(data) as Record<string, unknown>)
    const compactionDone = events.find(
      (event) =>
        event.type === "response.output_item.done"
        && (event.item as { type?: string } | undefined)?.type === "compaction",
    )

    expect(compactionDone).toBeDefined()
    const compaction = compactionDone?.item as
      | { encrypted_content?: string }
      | undefined
    expect(decodeMessagesCompaction(compaction?.encrypted_content ?? "")).toBe(
      summary,
    )
    expect(events.at(-1)?.type).toBe("response.completed")
  })

  test("replays Messages compaction without losing additional tools", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://openai-responses.example",
      models: { "glm-5.3": {} },
      name: "ali",
      type: "openai-responses",
    }

    const response = await createApp().request("/ali/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            role: "developer",
            tools: [{ name: "apply_patch", type: "custom" }],
            type: "additional_tools",
          },
          { content: "old", role: "user", type: "message" },
          {
            encrypted_content: encodeMessagesCompaction("Validated handoff"),
            id: "cmp-1",
            type: "compaction",
          },
          { content: "continue", role: "user", type: "message" },
        ],
        model: "glm-5.3",
      }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody(init?.body) as {
      input: Array<Record<string, unknown>>
    }
    expect(body.input).toHaveLength(3)
    expect(body.input[0]).toMatchObject({ role: "developer", type: "message" })
    expect(body.input[0]?.content).toContain("Validated handoff")
    expect(body.input[1]?.type).toBe("additional_tools")
    expect(body.input[2]).toMatchObject({ content: "continue", role: "user" })
  })

  test("adds Codex phases to direct provider Responses results", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://openai-responses.example",
      models: { "glm-5.3": {} },
      name: "ali",
      type: "openai-responses",
    }
    fetchMock.mockImplementation((_url, init) => {
      const body = parseJsonRequestBody(init?.body) as { model: string }
      return Promise.resolve(
        Response.json({
          ...createResponsesResult(body.model),
          output: [
            {
              content: [
                { annotations: [], text: "Working", type: "output_text" },
              ],
              id: "msg-1",
              role: "assistant",
              status: "completed",
              type: "message",
            },
            {
              arguments: "{}",
              call_id: "call-1",
              id: "fc-1",
              name: "read_file",
              namespace: "workspace",
              type: "function_call",
            },
          ],
        }),
      )
    })

    const response = await createApp().request("/ali/v1/responses", {
      body: JSON.stringify({ input: "hello", model: "glm-5.3" }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })
    const body = (await response.json()) as ResponsesResult
    expect(body.output[0]).toMatchObject({ phase: "commentary" })
  })

  test("buffers provider stream text until a later tool call sets commentary", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://openai-responses.example",
      models: { "glm-5.3": {} },
      name: "ali",
      type: "openai-responses",
    }
    const output = [
      {
        content: [{ annotations: [], text: "Checking", type: "output_text" }],
        id: "msg-1",
        role: "assistant",
        status: "completed",
        type: "message",
      },
      {
        arguments: "{}",
        call_id: "call-1",
        id: "fc-1",
        name: "read_file",
        type: "function_call",
      },
    ] as ResponsesResult["output"]
    const streamEvents = [
      {
        item: output[0],
        output_index: 0,
        sequence_number: 1,
        type: "response.output_item.added",
      },
      {
        content_index: 0,
        delta: "Checking",
        item_id: "msg-1",
        output_index: 0,
        sequence_number: 2,
        type: "response.output_text.delta",
      },
      {
        item: output[1],
        output_index: 1,
        sequence_number: 3,
        type: "response.output_item.added",
      },
      {
        response: { ...createResponsesResult("glm-5.3"), output },
        sequence_number: 4,
        type: "response.completed",
      },
    ]
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          streamEvents
            .map(
              (event) =>
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join("") + "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    )

    const response = await createApp().request("/ali/v1/responses", {
      body: JSON.stringify({ input: "hello", model: "glm-5.3", stream: true }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })
    const responseText = await response.text()
    const responseEvents = responseText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .filter((line) => line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)

    expect(responseEvents.map((event) => event.sequence_number)).toEqual([
      1, 2, 3, 4,
    ])
    expect(responseEvents[0]).toMatchObject({
      item: { phase: "commentary" },
    })
    const completedResponse = responseEvents[3]?.response as
      | ResponsesResult
      | undefined
    expect(completedResponse?.output[0]).toMatchObject({
      phase: "commentary",
    })
    expect(responseText.indexOf("response.completed")).toBeLessThan(
      responseText.indexOf("[DONE]"),
    )
  })

  test("keeps codex-prefixed provider models on the native Responses route for Codex clients", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://openai-responses.example",
      models: {
        "codex-mini-latest": {},
      },
      name: "openai",
      type: "openai-responses",
    }

    const response = await createApp().request("/openai/v1/responses", {
      body: JSON.stringify({
        input: "hello",
        model: "codex-mini-latest",
      }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, init] = fetchMock.mock.calls[0]
    const body = parseJsonRequestBody((init as RequestInit).body) as {
      input: unknown
      model: string
    }
    expect(body).toMatchObject({
      input: "hello",
      model: "codex-mini-latest",
    })
  })

  test("keeps native compaction for the built-in Codex provider", async () => {
    const originalCodexAccessToken = state.codexAccessToken
    const originalCodexAccountId = state.codexAccountId
    providerConfig = {
      apiKey: "",
      authType: "oauth2",
      baseUrl: "https://chatgpt.example/backend-api",
      models: { "gpt-test": {} },
      name: "codex",
      type: "openai-responses",
    }
    state.codexAccessToken = "synthetic-codex-token"
    state.codexAccountId = "synthetic-account"
    fetchMock.mockImplementation((_url, init) => {
      const requestBody = parseJsonRequestBody(init?.body) as {
        input: Array<Record<string, unknown>>
        model: string
      }
      expect(requestBody.input.at(-1)?.type).toBe("compaction_trigger")
      return Promise.resolve(
        Response.json({
          ...createResponsesResult(requestBody.model),
          output: [
            {
              encrypted_content: "native-compaction",
              id: "cmp-native",
              type: "compaction",
            },
          ],
        }),
      )
    })

    try {
      const response = await createApp().request("/codex/v1/responses", {
        body: JSON.stringify({
          input: [
            { content: "compact", role: "user", type: "message" },
            { type: "compaction_trigger" },
          ],
          model: "gpt-test",
        }),
        headers: {
          "content-type": "application/json",
          "user-agent": "codex-cli/1.0.0",
        },
        method: "POST",
      })

      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://chatgpt.example/backend-api/codex/responses",
      )
      const body = (await response.json()) as ResponsesResult
      expect(body.output[0]?.type).toBe("compaction")
    } finally {
      state.codexAccessToken = originalCodexAccessToken
      state.codexAccountId = originalCodexAccountId
    }
  })

  test("propagates provider-scoped client cancellation upstream without a 500", async () => {
    let upstreamSignal: AbortSignal | undefined
    const upstreamStarted = createDeferred()
    fetchMock.mockImplementation((_url, init) => {
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) {
        throw new Error("Expected upstream abort signal")
      }
      upstreamSignal = signal
      upstreamStarted.resolve()
      return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) {
          reject(
            signal.reason instanceof Error ?
              signal.reason
            : new Error("Provider request aborted"),
          )
          return
        }
        signal.addEventListener(
          "abort",
          () =>
            reject(
              signal.reason instanceof Error ?
                signal.reason
              : new Error("Provider request aborted"),
            ),
          { once: true },
        )
      })
    })
    const controller = new AbortController()
    const responsePromise = createApp().fetch(
      new Request("http://localhost/openai/v1/responses", {
        body: JSON.stringify({ input: "hello", model: "gpt-test" }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      }),
    )
    await upstreamStarted.promise

    controller.abort()

    const response = await responsePromise
    expect(upstreamSignal?.aborted).toBe(true)
    expect(response.status).toBe(499)
  })

  test("propagates provider-prefixed Codex cancellation upstream", async () => {
    const originalCodexAccessToken = state.codexAccessToken
    const originalCodexAccountId = state.codexAccountId
    let upstreamSignal: AbortSignal | undefined
    const upstreamStarted = createDeferred()
    providerConfig = {
      apiKey: "",
      authType: "oauth2",
      baseUrl: "https://chatgpt.example/backend-api",
      models: { "gpt-test": {} },
      name: "codex",
      type: "openai-responses",
    }
    state.codexAccessToken = "synthetic-codex-token"
    state.codexAccountId = "synthetic-account"
    fetchMock.mockImplementation((url, init) => {
      expect(url).toBe("https://chatgpt.example/backend-api/codex/responses")
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) {
        throw new Error("Expected upstream abort signal")
      }
      upstreamSignal = signal
      upstreamStarted.resolve()
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () =>
            reject(
              signal.reason instanceof Error ?
                signal.reason
              : new Error("Codex request aborted"),
            ),
          { once: true },
        )
      })
    })

    try {
      const controller = new AbortController()
      const responsePromise = createApp().fetch(
        new Request("http://localhost/codex/v1/responses", {
          body: JSON.stringify({ input: "hello", model: "gpt-test" }),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        }),
      )
      await upstreamStarted.promise

      controller.abort()

      const response = await responsePromise
      expect(upstreamSignal?.aborted).toBe(true)
      expect(response.status).toBe(499)
    } finally {
      state.codexAccessToken = originalCodexAccessToken
      state.codexAccountId = originalCodexAccountId
    }
  })

  test("adapts Responses Lite through Messages to Chat Completions", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://openai-chat.example",
      models: { "chat-test": {} },
      name: "openai",
      type: "openai-compatible",
      codexResponsesMode: "direct",
    }
    fetchMock.mockImplementation((_url, init) => {
      const body = parseJsonRequestBody(init?.body) as {
        model: string
        tools: Array<{
          type: string
          function: { name: string; strict?: boolean }
        }>
      }
      expect(body.model).toBe("chat-test")
      expect(body.tools.map((tool) => tool.function.name)).toEqual([
        "apply_patch",
        "workspace__read_file",
      ])
      expect(body.tools[0]?.function.strict).toBe(true)
      return Promise.resolve(
        Response.json({
          id: "chatcmpl-lite",
          object: "chat.completion",
          created: 1,
          model: "chat-test",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-patch",
                    type: "function",
                    function: {
                      name: "apply_patch",
                      arguments: JSON.stringify({
                        input: "*** Begin Patch",
                      }),
                    },
                  },
                  {
                    id: "call-read",
                    type: "function",
                    function: {
                      name: "workspace__read_file",
                      arguments: JSON.stringify({ path: "README.md" }),
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 6,
            total_tokens: 18,
          },
        }),
      )
    })

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "openai/chat-test",
        input: [
          {
            role: "developer",
            type: "additional_tools",
            tools: [
              { type: "custom", name: "apply_patch" },
              {
                type: "namespace",
                name: "workspace",
                tools: [
                  {
                    type: "function",
                    name: "read_file",
                    parameters: {
                      type: "object",
                      properties: { path: { type: "string" } },
                    },
                    strict: false,
                  },
                ],
              },
            ],
          },
          { type: "message", role: "user", content: "Update and read" },
        ],
      }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://openai-chat.example/v1/chat/completions",
    )
    const body = (await response.json()) as ResponsesResult
    expect(body.model).toBe("openai/chat-test")
    expect(body.output).toMatchObject([
      {
        type: "custom_tool_call",
        call_id: "call-patch",
        name: "apply_patch",
        input: "*** Begin Patch",
      },
      {
        type: "function_call",
        call_id: "call-read",
        name: "read_file",
        namespace: "workspace",
        arguments: JSON.stringify({ path: "README.md" }),
      },
    ])
  })

  test("applies strict to custom tools for the Kimi provider", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "authorization",
      baseUrl: "https://kimi.example",
      models: { k3: {} },
      name: "kimi",
      type: "openai-compatible",
    }
    fetchMock.mockImplementation((_url, init) => {
      const body = parseJsonRequestBody(init?.body) as {
        tools: Array<{
          function: Record<string, unknown>
          type: string
        }>
      }
      expect(body.tools).toHaveLength(1)
      expect(body.tools[0]?.function).toMatchObject({ name: "apply_patch" })
      expect(body.tools[0]?.function.strict).toBe(true)
      return Promise.resolve(
        Response.json({
          id: "chatcmpl-kimi",
          object: "chat.completion",
          created: 1,
          model: "k3",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "done" },
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 1,
            total_tokens: 5,
          },
        }),
      )
    })

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "kimi/k3",
        input: [
          {
            role: "developer",
            type: "additional_tools",
            tools: [{ type: "custom", name: "apply_patch" }],
          },
          { type: "message", role: "user", content: "Update the file" },
        ],
      }),
      headers: {
        "content-type": "application/json",
        "user-agent": "codex-cli/1.0.0",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://kimi.example/v1/chat/completions",
    )
    const responseBody = (await response.json()) as ResponsesResult
    expect(responseBody.output[0]).toMatchObject({ phase: "final_answer" })
  })

  test("adapts Responses Lite directly to an Anthropic Messages provider", async () => {
    providerConfig = {
      apiKey: "provider-key",
      authType: "x-api-key",
      baseUrl: "https://anthropic.example",
      models: { "claude-test": {} },
      name: "anthropic",
      type: "anthropic",
    }
    fetchMock.mockImplementation((_url, init) => {
      const body = parseJsonRequestBody(init?.body) as {
        model: string
        tools: Array<{ name: string }>
      }
      expect(body.model).toBe("claude-test")
      expect(body.tools.map((tool) => tool.name)).toEqual(["apply_patch"])
      return Promise.resolve(
        Response.json({
          content: [
            {
              type: "tool_use",
              id: "call-patch",
              name: "apply_patch",
              input: { input: "*** Begin Patch" },
            },
          ],
          id: "msg-lite",
          model: "claude-test",
          role: "assistant",
          stop_reason: "tool_use",
          stop_sequence: null,
          type: "message",
          usage: { input_tokens: 9, output_tokens: 4 },
        }),
      )
    })

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "anthropic/claude-test",
        input: [
          {
            role: "developer",
            type: "additional_tools",
            tools: [{ type: "custom", name: "apply_patch" }],
          },
          { type: "message", role: "user", content: "Patch it" },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://anthropic.example/v1/messages",
    )
    const body = (await response.json()) as ResponsesResult
    expect(body.model).toBe("anthropic/claude-test")
    expect(body.output[0]).toMatchObject({
      type: "custom_tool_call",
      call_id: "call-patch",
      name: "apply_patch",
      input: "*** Begin Patch",
    })
  })
})

const createDeferred = (): {
  promise: Promise<void>
  resolve: () => void
} => {
  let resolve!: () => void
  const promise = new Promise<void>((deferredResolve) => {
    resolve = deferredResolve
  })
  return { promise, resolve }
}

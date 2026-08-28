import { afterEach, describe, expect, test } from "bun:test"

import {
  getProviderApiPathPrefix,
  isResponsesProviderType,
  isSupportedProviderType,
  resolveEffectiveProviderType,
  resolveProviderAuthType,
  type ResolvedProviderConfig,
} from "~/lib/config"
import { builtinProviderModelRegistry } from "~/lib/builtin-provider-models"
import { QUICK_PROVIDER_CONFIGS } from "~/lib/quick-providers"
import type { ResponsesPayload } from "~/lib/types/responses"
import { normalizeProviderResponsesReasoningEffort } from "~/routes/provider/utils"
import {
  forwardProviderChatCompletions,
  forwardProviderMessages,
  forwardProviderModels,
  forwardProviderResponses,
} from "~/services/providers/provider-proxy"

const originalFetch = globalThis.fetch

const createArkProviderConfig = (
  overrides: Partial<ResolvedProviderConfig> = {},
): ResolvedProviderConfig => ({
  apiKey: "ark-key",
  authType: "authorization",
  baseUrl: "https://ark.example/api/coding",
  name: "doubao",
  type: "ark-doubao",
  ...overrides,
})

/** Captures the upstream URL of the next fetch and returns an empty 200. */
const captureUpstreamUrl = (): { get: () => string } => {
  let capturedUrl = ""
  globalThis.fetch = ((input: Request | URL | string) => {
    capturedUrl =
      typeof input === "string" ? input
      : input instanceof URL ? input.href
      : input.url
    return Promise.resolve(new Response("{}", { status: 200 }))
  }) as typeof globalThis.fetch
  return { get: () => capturedUrl }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("ark-doubao provider type", () => {
  test("is a supported provider type", () => {
    expect(isSupportedProviderType("ark-doubao")).toBe(true)
  })

  test("is treated as a Responses-capable provider", () => {
    expect(isResponsesProviderType("ark-doubao")).toBe(true)
    expect(isResponsesProviderType("openai-responses")).toBe(true)
    expect(isResponsesProviderType("openai-compatible")).toBe(false)
    expect(isResponsesProviderType("anthropic")).toBe(false)
  })

  test("uses the Ark /v3 path prefix and keeps /v1 for other types", () => {
    expect(getProviderApiPathPrefix("ark-doubao")).toBe("/v3")
    expect(getProviderApiPathPrefix("openai-responses")).toBe("/v1")
    expect(getProviderApiPathPrefix("openai-compatible")).toBe("/v1")
    expect(getProviderApiPathPrefix("anthropic")).toBe("/v1")
  })

  test("defaults to bearer authorization", () => {
    expect(resolveProviderAuthType("doubao", undefined, "ark-doubao")).toBe(
      "authorization",
    )
  })

  test("resolves as its own effective type", () => {
    expect(
      resolveEffectiveProviderType(createArkProviderConfig(), "doubao-seed"),
    ).toBe("ark-doubao")
  })

  test("allows a per-model type override", () => {
    const providerConfig = createArkProviderConfig({
      models: { "kimi-k2": { type: "openai-compatible" } },
    })

    expect(resolveEffectiveProviderType(providerConfig, "kimi-k2")).toBe(
      "openai-compatible",
    )
  })

  test("ships a doubao quick provider preset without a path prefix", () => {
    const doubao = QUICK_PROVIDER_CONFIGS.doubao

    expect(doubao.type).toBe("ark-doubao")
    expect(doubao.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/coding")
    expect(doubao.baseUrl.endsWith("/v1")).toBe(false)
    expect(doubao.baseUrl.endsWith("/v3")).toBe(false)
  })

  test("downgrades the unsupported none reasoning effort for Ark", () => {
    const payload: ResponsesPayload = {
      model: "kimi-k2.7-code",
      reasoning: { effort: "none" as const },
    }

    expect(
      normalizeProviderResponsesReasoningEffort(
        payload,
        createArkProviderConfig(),
      ),
    ).toEqual({ from: "none", to: "low" })
    expect(payload.reasoning?.effort).toBe("low")
  })
})

describe("doubao curated model catalog", () => {
  test("exposes the console's recommended model ids", () => {
    expect(builtinProviderModelRegistry.getModelIds("doubao")).toEqual([
      "ark-code-latest",
      "doubao-seed-evolving",
      "doubao-seed-2.1-turbo",
      "doubao-seed-2.0-lite",
      "glm-5.3",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "glm-5.2",
      "kimi-k2.7-code",
      "minimax-m3",
    ])
  })

  test("uses unversioned console aliases rather than dated upstream ids", () => {
    const modelIds = builtinProviderModelRegistry.getModelIds("doubao")

    for (const modelId of modelIds) {
      expect(modelId).not.toMatch(/-\d{6}$/u)
    }
  })

  test("carries pricing metadata for every catalog entry", () => {
    for (const modelId of builtinProviderModelRegistry.getModelIds("doubao")) {
      const modelConfig = builtinProviderModelRegistry.getModelConfig(
        "doubao",
        modelId,
      )

      expect(modelConfig?.pricing).toBeDefined()
      expect(modelConfig?.contextWindow).toBeGreaterThan(0)
    }
  })
})

describe("ark-doubao upstream routing", () => {
  test("routes responses to /v3/responses", async () => {
    const captured = captureUpstreamUrl()

    await forwardProviderResponses(
      createArkProviderConfig(),
      { input: [], model: "doubao-seed" },
      new Headers(),
    )

    expect(captured.get()).toBe("https://ark.example/api/coding/v3/responses")
  })

  test("routes models to /v3/models", async () => {
    const captured = captureUpstreamUrl()

    await forwardProviderModels(createArkProviderConfig(), new Headers())

    expect(captured.get()).toBe("https://ark.example/api/coding/v3/models")
  })

  test("routes chat completions to /v3/chat/completions", async () => {
    const captured = captureUpstreamUrl()

    await forwardProviderChatCompletions(
      createArkProviderConfig(),
      { messages: [], model: "doubao-seed" },
      new Headers(),
    )

    expect(captured.get()).toBe(
      "https://ark.example/api/coding/v3/chat/completions",
    )
  })

  test("keeps the /v1 prefix for openai-responses providers", async () => {
    const captured = captureUpstreamUrl()

    await forwardProviderResponses(
      createArkProviderConfig({
        baseUrl: "https://openai.example",
        name: "custom",
        type: "openai-responses",
      }),
      { input: [], model: "gpt-5" },
      new Headers(),
    )

    expect(captured.get()).toBe("https://openai.example/v1/responses")
  })

  test("keeps the /v1 prefix for anthropic providers", async () => {
    const captured = captureUpstreamUrl()

    await forwardProviderMessages(
      createArkProviderConfig({
        authType: "x-api-key",
        baseUrl: "https://anthropic.example",
        name: "custom",
        type: "anthropic",
      }),
      { max_tokens: 16, messages: [], model: "claude" },
      new Headers(),
    )

    expect(captured.get()).toBe("https://anthropic.example/v1/messages")
  })
})

describe("doubao /v1/models catalog source", () => {
  test("serves the curated catalog without calling upstream /models", async () => {
    let upstreamCalls = 0
    globalThis.fetch = (() => {
      upstreamCalls += 1
      return Promise.resolve(
        Response.json({ data: [{ id: "deepseek-v4-pro-260425" }] }),
      )
    }) as unknown as typeof globalThis.fetch

    const { modelRoutes } = await import("~/routes/models/route")
    const response = await modelRoutes.request("/", {
      headers: { "user-agent": "curl/8.0" },
    })
    const body = (await response.json()) as { data: Array<{ id: string }> }
    const doubaoIds = body.data
      .filter((model) => model.id.startsWith("doubao/"))
      .map((model) => model.id)

    expect(upstreamCalls).toBe(0)
    expect(doubaoIds).toContain("doubao/kimi-k2.7-code")
    expect(doubaoIds).toContain("doubao/ark-code-latest")
    expect(doubaoIds).not.toContain("doubao/deepseek-v4-pro-260425")
  })
})

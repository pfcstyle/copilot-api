import { afterEach, describe, expect, test } from "bun:test"

import { QUICK_PROVIDER_CONFIGS } from "~/lib/quick-providers"
import type { ResponsesPayload } from "~/lib/types/responses"
import { normalizeProviderResponsesReasoningEffort } from "~/routes/provider/utils"
import {
  forwardProviderChatCompletions,
  forwardProviderModels,
  forwardProviderResponses,
} from "~/services/providers/provider-proxy"
import type { ResolvedProviderConfig } from "~/lib/config"

const originalFetch = globalThis.fetch

const createAliProviderConfig = (
  overrides: Partial<ResolvedProviderConfig> = {},
): ResolvedProviderConfig => ({
  apiKey: "ali-key",
  authType: "authorization",
  baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  name: "ali",
  type: "openai-responses",
  ...overrides,
})

const captureUpstreamUrl = (): { get: () => string } => {
  let capturedUrl = ""
  globalThis.fetch = ((input: Request | URL | string) => {
    capturedUrl =
      typeof input === "string" ? input
      : input instanceof URL ? input.href
      : input.url
    return Promise.resolve(new Response("{}", { status: 200 }))
  }) as unknown as typeof globalThis.fetch
  return { get: () => capturedUrl }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("Aliyun Token Plan provider", () => {
  test("ships an OpenAI Responses quick provider preset", () => {
    expect(QUICK_PROVIDER_CONFIGS.ali).toEqual({
      baseUrl:
        "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      editableType: false,
      pricingCurrency: "CNY",
      type: "openai-responses",
    })
  })

  test("does not duplicate the /v1 prefix for Responses", async () => {
    const captured = captureUpstreamUrl()

    await forwardProviderResponses(
      createAliProviderConfig(),
      { input: "hello", model: "kimi-k2.7-code" },
      new Headers(),
    )

    expect(captured.get()).toBe(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses",
    )
  })

  test("maps the unsupported none reasoning effort to low", () => {
    const payload: ResponsesPayload = {
      model: "kimi-k2.7-code",
      reasoning: { effort: "none" as const },
    }

    expect(
      normalizeProviderResponsesReasoningEffort(
        payload,
        createAliProviderConfig(),
      ),
    ).toEqual({ from: "none", to: "low" })
    expect(payload.reasoning?.effort).toBe("low")
  })

  test("uses the same versioned base URL for models and chat completions", async () => {
    const captured = captureUpstreamUrl()
    await forwardProviderModels(createAliProviderConfig(), new Headers())
    expect(captured.get()).toBe(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models",
    )

    await forwardProviderChatCompletions(
      createAliProviderConfig(),
      { messages: [], model: "kimi-k2.7-code" },
      new Headers(),
    )
    expect(captured.get()).toBe(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    )
  })
})

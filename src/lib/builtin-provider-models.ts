import type { TokenUsagePricingConfig } from "./token-usage/pricing"
import type { CodexReasoningEffort } from "./config-store"

export type BuiltinProviderInputModality = "text" | "image"

export interface BuiltinProviderModelConfig {
  contextWindow?: number
  defaultReasoningEffort?: CodexReasoningEffort
  inputModalities?: Array<BuiltinProviderInputModality>
  maxOutputTokens?: number
  pricing: TokenUsagePricingConfig
  reasoningEfforts?: Array<CodexReasoningEffort>
}

type BuiltinProviderModelCatalog = Record<
  string,
  Record<string, BuiltinProviderModelConfig>
>

export class BuiltinProviderModelRegistry {
  private static readonly catalog: BuiltinProviderModelCatalog = {
    codex: {
      "gpt-5.3-codex": {
        pricing: {
          cachedInput: 0.175,
          input: 1.75,
          output: 14,
        },
      },
      "gpt-5.4": {
        pricing: {
          tiers: [
            {
              cachedInput: 0.25,
              input: 2.5,
              maxInputTokens: 272_000,
              output: 15,
            },
            {
              cachedInput: 0.5,
              input: 5,
              output: 22.5,
            },
          ],
        },
      },
      "gpt-5.4-mini": {
        pricing: {
          tiers: [
            {
              cachedInput: 0.075,
              input: 0.75,
              maxInputTokens: 272_000,
              output: 4.5,
            },
            {
              cachedInput: 0.15,
              input: 1.5,
              output: 6.75,
            },
          ],
        },
      },
      "gpt-5.5": {
        pricing: {
          tiers: [
            {
              cachedInput: 0.5,
              input: 5,
              maxInputTokens: 272_000,
              output: 30,
            },
            {
              cachedInput: 1,
              input: 10,
              output: 45,
            },
          ],
        },
      },
      "gpt-5.6-sol": {
        pricing: {
          tiers: [
            {
              cacheCreationInput: 5,
              cachedInput: 0.4,
              input: 4,
              maxInputTokens: 272_000,
              output: 20,
            },
            {
              cacheCreationInput: 10,
              cachedInput: 0.8,
              input: 8,
              output: 30,
            },
          ],
        },
      },
      "gpt-5.6-terra": {
        pricing: {
          tiers: [
            {
              cacheCreationInput: 2.5,
              cachedInput: 0.2,
              input: 2,
              maxInputTokens: 272_000,
              output: 12,
            },
            {
              cacheCreationInput: 5,
              cachedInput: 0.4,
              input: 4,
              output: 18,
            },
          ],
        },
      },
      "gpt-5.6-luna": {
        pricing: {
          tiers: [
            {
              cacheCreationInput: 0.25,
              cachedInput: 0.02,
              input: 0.2,
              maxInputTokens: 272_000,
              output: 1.2,
            },
            {
              cacheCreationInput: 0.5,
              cachedInput: 0.04,
              input: 0.4,
              output: 1.8,
            },
          ],
        },
      },
    },
    dashscope: {
      "glm-5.1": {
        contextWindow: 202_752,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          tiers: [
            {
              cachedInput: 1.2,
              cacheCreationInput: 7.5,
              explicitCachedInput: 0.6,
              input: 6,
              maxInputTokens: 32_000,
              output: 24,
            },
            {
              cachedInput: 1.6,
              cacheCreationInput: 10,
              explicitCachedInput: 0.8,
              input: 8,
              maxInputTokens: 200_000,
              output: 28,
            },
          ],
        },
      },
      "glm-5.2": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 2,
          cacheCreationInput: 10,
          explicitCachedInput: 0.8,
          input: 8,
          output: 28,
        },
      },
      "qwen3.7-max": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 2.4,
          cacheCreationInput: 15,
          explicitCachedInput: 1.2,
          input: 12,
          output: 36,
        },
      },
      "qwen3.8-max": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 1.5,
          cacheCreationInput: 15,
          explicitCachedInput: 1,
          input: 12,
          output: 36,
        },
      },
      "deepseek-v4-flash-0731": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.2,
          input: 1,
          output: 2,
        },
      },
      "qwen3.7-plus": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          tiers: [
            {
              cachedInput: 0.4,
              cacheCreationInput: 2.5,
              explicitCachedInput: 0.2,
              input: 2,
              maxInputTokens: 256_000,
              output: 8,
            },
            {
              cachedInput: 1.2,
              cacheCreationInput: 7.5,
              explicitCachedInput: 0.6,
              input: 6,
              maxInputTokens: 1_000_000,
              output: 24,
            },
          ],
        },
      },
      "kimi/kimi-k3": {
        contextWindow: 1_048_576,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 2,
          input: 20,
          output: 100,
        },
      },
    },
    deepseek: {
      "deepseek-v4-flash": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.1,
          input: 3,
          output: 9,
        },
      },
      "deepseek-v4-flash-vision-exp": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.1,
          input: 3,
          output: 9,
        },
      },
      "deepseek-v4-pro": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.3,
          input: 9,
          output: 27,
        },
      },
    },
    "opencode-go": {
      hy3: {
        contextWindow: 256_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.035,
          input: 0.14,
          output: 0.58,
        },
      },
      "gpt-5.6-luna": {
        pricing: {
          tiers: [
            {
              cacheCreationInput: 0.125,
              cachedInput: 0.01,
              input: 0.1,
              maxInputTokens: 272_000,
              output: 0.6,
            },
            {
              cacheCreationInput: 0.25,
              cachedInput: 0.02,
              input: 0.2,
              output: 0.9,
            },
          ],
        },
      },
      "glm-5.2": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.26,
          input: 1.4,
          output: 4.4,
        },
      },
      "glm-5.3": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.26,
          input: 1.4,
          output: 4.4,
        },
      },
      "glm-5.3-flash": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 131_072,
        pricing: {
          cachedInput: 0.015,
          input: 0.075,
          output: 0.25,
        },
        reasoningEfforts: ["low", "high", "max"],
      },
      "muse-spark-1.2-contributor": {
        contextWindow: 1_048_576,
        inputModalities: ["text", "image"],
        maxOutputTokens: 131_072,
        pricing: {
          cachedInput: 0.002,
          input: 0.1,
          output: 0.2,
        },
        reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
      },
      "grok-4.5": {
        contextWindow: 500_000,
        defaultReasoningEffort: "high",
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          tiers: [
            {
              cachedInput: 0.5,
              input: 2,
              maxInputTokens: 200_000,
              output: 6,
            },
            {
              cachedInput: 1,
              input: 4,
              output: 12,
            },
          ],
        },
        reasoningEfforts: ["low", "medium", "high"],
      },
      "deepseek-v4-flash": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.007,
          input: 0.22,
          output: 0.66,
        },
      },
      "deepseek-v4-flash-vision-exp": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 384_000,
        pricing: {
          cachedInput: 0.007,
          input: 0.22,
          output: 0.66,
        },
        reasoningEfforts: ["low", "high", "max"],
      },
      "deepseek-v4-pro": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.022,
          input: 0.66,
          output: 1.98,
        },
      },
      "kimi-k2.7-code": {
        contextWindow: 262_144,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.19,
          input: 0.95,
          output: 4,
        },
      },
      "kimi-k3": {
        contextWindow: 1_048_576,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.3,
          input: 3,
          output: 15,
        },
      },
      "mimo-v2.5": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.0028,
          input: 0.14,
          output: 0.28,
        },
      },
      "mimo-v2.5-pro": {
        contextWindow: 1_048_576,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.0145,
          input: 1.74,
          output: 3.48,
        },
      },
      "qwen3.7-plus": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          tiers: [
            {
              cacheCreationInput: 0.5,
              cachedInput: 0.04,
              input: 0.4,
              maxInputTokens: 200_000,
              output: 1.6,
            },
            {
              cacheCreationInput: 1.5,
              cachedInput: 0.12,
              input: 1.2,
              maxInputTokens: 256_000,
              output: 4.8,
            },
          ],
        },
      },
      "qwen3.7-max": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cacheCreationInput: 3.125,
          cachedInput: 0.5,
          input: 2.5,
          output: 7.5,
        },
      },
      "qwen3.8-max": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cacheCreationInput: 2.5,
          cachedInput: 0.25,
          input: 2,
          output: 6,
        },
      },
      "minimax-m2.7": {
        contextWindow: 204_800,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.06,
          input: 0.3,
          output: 1.2,
        },
      },
      "minimax-m3": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          tiers: [
            {
              cachedInput: 0.06,
              input: 0.3,
              maxInputTokens: 200_000,
              output: 1.2,
            },
            {
              cachedInput: 0.12,
              input: 0.6,
              maxInputTokens: 512_000,
              output: 2.4,
            },
          ],
        },
      },
    },
    kimi: {
      k3: {
        contextWindow: 1_048_576,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.3,
          input: 3,
          output: 15,
        },
      },
      "k3-256k": {
        contextWindow: 262_144,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.3,
          input: 3,
          output: 15,
        },
      },
    },
  }

  private readonly modelCatalog: BuiltinProviderModelCatalog

  constructor() {
    this.modelCatalog = BuiltinProviderModelRegistry.catalog
  }

  getModelConfig(
    providerName: string,
    modelName: string,
  ): BuiltinProviderModelConfig | undefined {
    return this.modelCatalog[this.normalizeKey(providerName)]?.[
      this.normalizeKey(modelName)
    ]
  }

  getModelIds(providerName: string): Array<string> {
    return Object.keys(this.modelCatalog[this.normalizeKey(providerName)] ?? {})
  }

  private normalizeKey(value: string): string {
    return value.trim().toLowerCase()
  }
}

export const builtinProviderModelRegistry = new BuiltinProviderModelRegistry()

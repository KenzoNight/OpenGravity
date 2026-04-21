import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ModelDescriptor } from "@opengravity/shared-types";

import { mapOpenRouterCatalog, mergeModelCatalog } from "./provider-catalog.js";

describe("provider-catalog", () => {
  it("maps OpenRouter models into provider-aware descriptors", () => {
    const models = mapOpenRouterCatalog({
      data: [
        {
          id: "openrouter/elephant-alpha",
          name: "Elephant",
          context_length: 262144,
          pricing: {
            prompt: "0",
            completion: "0"
          },
          supported_parameters: ["tools", "temperature"]
        },
        {
          id: "moonshotai/kimi-k2.6",
          name: "MoonshotAI: Kimi K2.6",
          context_length: 262144,
          pricing: {
            prompt: "0.0000006",
            completion: "0.0000028"
          },
          supported_parameters: ["temperature"]
        }
      ]
    });

    assert.equal(models[0]?.id, "openrouter/elephant-alpha");
    assert.equal(models[0]?.isFree, true);
    assert.equal(models[0]?.supportsTools, true);
    assert.equal(models[1]?.costTier, "medium");
  });

  it("merges discovered models into the base model catalog", () => {
    const baseModels: ModelDescriptor[] = [
      {
        id: "openrouter-claude-4-sonnet",
        label: "OpenRouter Claude 4 Sonnet",
        provider: "openrouter",
        qualityTier: "strong",
        costTier: "medium",
        supportsTools: true,
        maxContextWindow: 200000
      }
    ];
    const discoveredModels = mapOpenRouterCatalog({
      data: [
        {
          id: "openrouter-claude-4-sonnet",
          name: "OpenRouter Claude 4 Sonnet",
          context_length: 200000,
          pricing: {
            prompt: "0.000002",
            completion: "0.00001"
          },
          supported_parameters: ["tools"]
        },
        {
          id: "openrouter/elephant-alpha",
          name: "Elephant",
          context_length: 262144,
          pricing: {
            prompt: "0",
            completion: "0"
          },
          supported_parameters: ["tools"]
        }
      ]
    });

    const merged = mergeModelCatalog(baseModels, discoveredModels);

    assert.equal(merged.length, 2);
    assert.ok(merged.some((model) => model.id === "openrouter/elephant-alpha"));
    assert.equal(
      merged.find((model) => model.id === "openrouter-claude-4-sonnet")?.maxContextWindow,
      200000
    );
  });
});

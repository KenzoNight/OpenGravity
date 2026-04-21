import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ModelDescriptor } from "@opengravity/shared-types";

import { selectNextModel } from "./index.js";

const makeModel = (overrides: Partial<ModelDescriptor>): ModelDescriptor => ({
  id: "model",
  label: "Model",
  provider: "custom",
  qualityTier: "balanced",
  costTier: "medium",
  supportsTools: true,
  maxContextWindow: 128000,
  ...overrides
});

describe("selectNextModel", () => {
  it("fails over from the active model to the best available alternative", () => {
    const decision = selectNextModel(
      {
        taskType: "build-repair",
        activeModelId: "claude-4-opus",
        excludedModelIds: ["claude-4-opus"],
        needsLongContext: true,
        requiresStrongReasoning: true
      },
      [
        {
          model: makeModel({
            id: "claude-4-opus",
            label: "Claude 4 Opus",
            provider: "anthropic",
            qualityTier: "strong",
            maxContextWindow: 200000
          }),
          available: true,
          healthScore: 90
        },
        {
          model: makeModel({
            id: "gemini-2.5-pro",
            label: "Gemini 2.5 Pro",
            provider: "gemini",
            qualityTier: "strong",
            maxContextWindow: 1048576
          }),
          available: true,
          healthScore: 83
        },
        {
          model: makeModel({
            id: "gpt-fast",
            label: "GPT Fast",
            provider: "openai",
            qualityTier: "fast",
            maxContextWindow: 128000
          }),
          available: true,
          healthScore: 88
        }
      ]
    );

    assert.equal(decision.chosen.id, "gemini-2.5-pro");
    assert.ok(decision.reasons.includes("strong-reasoning"));
    assert.ok(decision.reasons.includes("supports-tools"));
  });

  it("throws when no candidates remain", () => {
    assert.throws(
      () =>
      selectNextModel(
        {
          taskType: "code",
          excludedModelIds: ["a"]
        },
        [
          {
            model: makeModel({ id: "a" }),
            available: false,
            healthScore: 0
          }
        ]
      ),
      /No eligible model candidates/
    );
  });
});

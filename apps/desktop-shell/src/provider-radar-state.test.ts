import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ModelDescriptor, ProviderHealth } from "@opengravity/shared-types";

import { buildProviderRadar } from "./provider-radar-state.js";
import type { WorkbenchSettings } from "./settings-state.js";

const models: ModelDescriptor[] = [
  {
    id: "claude-4-opus",
    label: "Claude 4 Opus",
    provider: "anthropic",
    qualityTier: "strong",
    costTier: "high",
    supportsTools: true,
    maxContextWindow: 200000
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "gemini",
    qualityTier: "strong",
    costTier: "medium",
    supportsTools: true,
    maxContextWindow: 1000000
  },
  {
    id: "openai/gpt-oss-20b",
    label: "Groq GPT-OSS 20B",
    provider: "groq",
    qualityTier: "balanced",
    costTier: "low",
    supportsTools: true,
    maxContextWindow: 131072
  }
];

const settings: WorkbenchSettings = {
  activeModelId: "gemini-2.5-pro",
  autoHandoff: true,
  parallelAgentMode: false,
  concurrentAgentCount: 1,
  providerProfiles: [
    {
      provider: "anthropic",
      label: "Anthropic",
      enabled: true,
      preferredModelId: "claude-4-opus",
      allowFallback: true,
      primaryAccountId: "anthropic-1"
    },
    {
      provider: "gemini",
      label: "Gemini",
      enabled: true,
      preferredModelId: "gemini-2.5-pro",
      allowFallback: true,
      primaryAccountId: "gemini-1"
    },
    {
      provider: "groq",
      label: "Groq",
      enabled: true,
      preferredModelId: "openai/gpt-oss-20b",
      allowFallback: true,
      primaryAccountId: "groq-1"
    }
  ],
  providerAccounts: [
    {
      id: "anthropic-1",
      provider: "anthropic",
      label: "Anthropic Main",
      enabled: true,
      apiKey: "anthropic-key",
      baseUrl: ""
    },
    {
      id: "gemini-1",
      provider: "gemini",
      label: "Gemini Main",
      enabled: true,
      apiKey: "gemini-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai"
    },
    {
      id: "gemini-2",
      provider: "gemini",
      label: "Gemini Overflow",
      enabled: true,
      apiKey: "gemini-key-2",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai"
    },
    {
      id: "groq-1",
      provider: "groq",
      label: "Groq Main",
      enabled: true,
      apiKey: "groq-key",
      baseUrl: "https://api.groq.com/openai/v1"
    }
  ]
};

const providerHealth: ProviderHealth[] = [
  {
    provider: "anthropic",
    state: "rate_limited",
    scoreModifier: -80,
    reason: "Claude is temporarily exhausted."
  },
  {
    provider: "gemini",
    state: "healthy",
    scoreModifier: 20,
    reason: "Gemini has the best spare headroom."
  },
  {
    provider: "groq",
    state: "healthy",
    scoreModifier: 12,
    reason: "Groq is fast and ready as a fallback."
  }
];

describe("provider-radar-state", () => {
  it("recommends the healthiest ready provider", () => {
    const radar = buildProviderRadar(settings, providerHealth, models);

    assert.equal(radar.recommended?.provider, "gemini");
    assert.equal(radar.fallback?.provider, "groq");
  });

  it("tracks the active provider from the active model", () => {
    const radar = buildProviderRadar(settings, providerHealth, models);

    assert.equal(radar.active?.provider, "gemini");
    assert.equal(radar.active?.preferredModelLabel, "Gemini 2.5 Pro");
  });

  it("summarizes ready providers and ready accounts", () => {
    const radar = buildProviderRadar(settings, providerHealth, models);

    assert.equal(radar.readyProviderCount, 3);
    assert.equal(radar.readyAccountCount, 4);
    assert.equal(radar.entries[0]?.primaryAccountLabel, "Gemini Main");
  });
});

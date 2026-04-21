import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createChatMessage, type ProviderChatMessage } from "./chat-state.js";
import {
  buildParallelAgentTargets,
  decorateMessagesForParallelTarget
} from "./multiagent-state.js";
import {
  addProviderAccount,
  createDefaultWorkbenchSettings,
  updateProviderAccount,
  updateProviderProfile
} from "./settings-state.js";
import { desktopShellModels } from "./shell-state.js";

describe("multiagent-state", () => {
  it("builds parallel targets from multiple ready providers and accounts", () => {
    let settings = createDefaultWorkbenchSettings(desktopShellModels);
    settings = updateProviderProfile(
      settings,
      "gemini",
      {
        enabled: true,
        preferredModelId: "gemini-2.5-pro"
      },
      desktopShellModels
    );
    settings = updateProviderAccount(
      settings,
      settings.providerAccounts.find((account) => account.provider === "gemini")!.id,
      {
        apiKey: "AIza-test-1234"
      },
      desktopShellModels
    );
    settings = updateProviderProfile(
      settings,
      "groq",
      {
        enabled: true,
        preferredModelId: "openai/gpt-oss-120b"
      },
      desktopShellModels
    );
    settings = updateProviderAccount(
      settings,
      settings.providerAccounts.find((account) => account.provider === "groq")!.id,
      {
        apiKey: "gsk_test_1234"
      },
      desktopShellModels
    );
    settings = addProviderAccount(settings, "gemini");
    settings = updateProviderAccount(
      settings,
      settings.providerAccounts.find(
        (account) => account.provider === "gemini" && account.label.includes("2")
      )!.id,
      {
        apiKey: "AIza-test-5678",
        label: "Gemini Backup"
      },
      desktopShellModels
    );

    const targets = buildParallelAgentTargets({
      activeModelId: "gemini-2.5-pro",
      maxCount: 3,
      models: desktopShellModels,
      preferredModelId: "gemini-2.5-pro",
      preferredProvider: "gemini",
      settings
    });

    assert.equal(targets.length, 3);
    assert.equal(targets[0]?.provider, "gemini");
    assert.equal(targets[1]?.provider, "gemini");
    assert.equal(targets[2]?.provider, "groq");
    assert.equal(targets[0]?.roleLabel, "Architect");
  });

  it("adds a role directive to the system prompt for each lane", () => {
    const messages: ProviderChatMessage[] = [
      {
        role: "system",
        content: "Base instructions"
      },
      {
        role: "user",
        content: createChatMessage("user", "Fix the build").content
      }
    ];

    const decorated = decorateMessagesForParallelTarget(
      messages,
      {
        account: {
          apiKey: "AIza-test-1234",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          enabled: true,
          id: "gemini-account-1",
          label: "Gemini Default",
          provider: "gemini"
        },
        modelId: "gemini-2.5-pro",
        provider: "gemini",
        roleLabel: "Reviewer"
      },
      3
    );

    assert.match(decorated[0]!.content, /Parallel agent lane: Reviewer/i);
    assert.match(decorated[0]!.content, /one of 3 concurrent agent lanes/i);
  });
});

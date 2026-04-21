import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { browserFallbackHealth, buildDesktopShellSnapshot, desktopShellModels } from "./shell-state.js";
import {
  buildChatSystemPrompt,
  canRunAgentWorkflow,
  createChatMessage,
  getChatComposerPlaceholder,
  getChatModeDescription
} from "./chat-state.js";
import { createDefaultWorkbenchSettings } from "./settings-state.js";

describe("chat-state", () => {
  it("locks down ask and planning modes", () => {
    const snapshot = buildDesktopShellSnapshot(browserFallbackHealth, createDefaultWorkbenchSettings(desktopShellModels));
    const askPrompt = buildChatSystemPrompt("ask", snapshot, "README.md", "hello");
    const planningPrompt = buildChatSystemPrompt("planning", snapshot, "README.md", "hello");

    assert.match(askPrompt, /Do not propose code edits/i);
    assert.match(planningPrompt, /Do not generate shell commands/i);
    assert.equal(canRunAgentWorkflow("ask"), false);
    assert.equal(canRunAgentWorkflow("planning"), false);
    assert.equal(canRunAgentWorkflow("agent"), true);
  });

  it("exposes user-facing mode labels and chat message metadata", () => {
    const message = createChatMessage("assistant", "Ready", { accountLabel: "OpenRouter A", modelId: "qwen/qwen3-coder:free" });

    assert.equal(message.accountLabel, "OpenRouter A");
    assert.equal(message.modelId, "qwen/qwen3-coder:free");
    assert.match(getChatModeDescription("ask"), /Answer questions only/i);
    assert.match(getChatComposerPlaceholder("agent"), /Ask the agent/i);
  });
});

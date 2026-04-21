import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { browserFallbackHealth, buildDesktopShellSnapshot, desktopShellModels } from "./shell-state.js";
import {
  buildChatSystemPrompt,
  canRunAgentWorkflow,
  createDefaultChatSession,
  createChatMessage,
  getChatHistoryStorageKey,
  getChatComposerPlaceholder,
  getChatModeDescription,
  normalizePersistedChatSession,
  serializePersistedChatSession
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

  it("normalizes persisted chat sessions per workspace", () => {
    const normalized = normalizePersistedChatSession({
      mode: "agent",
      messages: [
        {
          id: "one",
          role: "user",
          content: "Fix the compile failure",
          timestamp: "2026-04-21T09:00:00.000Z"
        },
        {
          id: "two",
          role: "assistant",
          content: "I would inspect CMake first.",
          accountLabel: "Gemini Default",
          agentRole: "Architect",
          modelId: "gemini-2.5-pro",
          timestamp: "2026-04-21T09:00:05.000Z"
        }
      ]
    });

    assert.equal(normalized.mode, "agent");
    assert.equal(normalized.messages[1]?.agentRole, "Architect");
    assert.match(getChatHistoryStorageKey("C:/Workspace/OpenGravity"), /opengravity\.chat-history\.v1/i);
    assert.equal(
      JSON.parse(serializePersistedChatSession(normalized)).messages[1]?.accountLabel,
      "Gemini Default"
    );
    assert.equal(createDefaultChatSession().messages.length, 1);
  });
});

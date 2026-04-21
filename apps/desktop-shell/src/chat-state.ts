import type { DesktopShellSnapshot } from "./shell-state";

export type ChatMode = "ask" | "planning" | "agent";
export type ChatMessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  accountLabel?: string;
  modelId?: string;
  timestamp: string;
}

export interface ProviderChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

let nextMessageId = 1;

export function createChatMessage(
  role: ChatMessageRole,
  content: string,
  metadata: Partial<Pick<ChatMessage, "accountLabel" | "modelId" | "timestamp">> = {}
): ChatMessage {
  return {
    id: `chat-${nextMessageId++}`,
    role,
    content,
    accountLabel: metadata.accountLabel,
    modelId: metadata.modelId,
    timestamp: metadata.timestamp ?? new Date().toISOString()
  };
}

export function getChatModeDescription(mode: ChatMode): string {
  switch (mode) {
    case "ask":
      return "Answer questions only. Do not propose edits, commands, or workflow execution.";
    case "planning":
      return "Plan the work only. Do not write code, patches, or shell commands.";
    case "agent":
      return "Reason like a coding agent. You may suggest concrete implementation steps and code.";
  }
}

export function getChatComposerPlaceholder(mode: ChatMode): string {
  switch (mode) {
    case "ask":
      return "Ask a question about the workspace, build failure, or current session.";
    case "planning":
      return "Describe the task and get a plan without writing code.";
    case "agent":
      return "Ask the agent to reason about edits, fixes, or execution strategy.";
  }
}

export function canRunAgentWorkflow(mode: ChatMode): boolean {
  return mode === "agent";
}

export function buildChatSystemPrompt(
  mode: ChatMode,
  snapshot: DesktopShellSnapshot,
  activeFilePath: string,
  activeFileContent: string
): string {
  const baseContext = [
    "You are OpenGravity, a desktop coding assistant inside a local development environment.",
    `Current task: ${snapshot.handoffPlan.continuityPack.currentGoal}`,
    `Primary language: ${snapshot.profile.primaryLanguage ?? "unknown"}`,
    `Build system: ${snapshot.executionPlan.primaryBuildSystem ?? "unknown"}`,
    `Active file: ${activeFilePath || "none"}`,
    `Open blockers: ${snapshot.handoffPlan.continuityPack.openBlockers.join("; ") || "none"}`,
    `Pending actions: ${snapshot.handoffPlan.continuityPack.pendingActions.join("; ") || "none"}`
  ];

  const activeFileSnippet = activeFileContent.trim()
    ? `Active file contents:\n${activeFileContent.slice(0, 12000)}`
    : "Active file contents: empty file";

  if (mode === "ask") {
    return [
      ...baseContext,
      "Mode: ASK.",
      "You must answer the user's question directly and conservatively.",
      "Do not propose code edits, do not output patches, do not suggest writing files, and do not suggest running commands unless the user explicitly asks for commands.",
      "Do not act like you changed anything in the workspace.",
      activeFileSnippet
    ].join("\n\n");
  }

  if (mode === "planning") {
    return [
      ...baseContext,
      "Mode: PLANNING.",
      "You must produce a plan only.",
      "Do not write code, do not output patches, do not generate file contents, do not generate shell commands, and do not claim that any change was made.",
      "Use numbered steps and call out risks, assumptions, and validation steps.",
      activeFileSnippet
    ].join("\n\n");
  }

  return [
    ...baseContext,
    "Mode: AGENT.",
    "You may reason about concrete implementation details and propose code-level changes.",
    "However, you are still a chat response in this environment: do not claim to have edited files unless the UI explicitly tells you a change was applied.",
    activeFileSnippet
  ].join("\n\n");
}

export function buildProviderChatMessages(
  mode: ChatMode,
  snapshot: DesktopShellSnapshot,
  activeFilePath: string,
  activeFileContent: string,
  history: ChatMessage[],
  userInput: string
): ProviderChatMessage[] {
  const systemPrompt = buildChatSystemPrompt(mode, snapshot, activeFilePath, activeFileContent);
  const messages: ProviderChatMessage[] = [
    {
      role: "system",
      content: systemPrompt
    }
  ];

  for (const message of history.slice(-12)) {
    if (message.role === "system") {
      continue;
    }

    messages.push({
      role: message.role,
      content: message.content
    });
  }

  messages.push({
    role: "user",
    content: userInput
  });

  return messages;
}

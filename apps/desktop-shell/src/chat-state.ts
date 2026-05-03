import type { DesktopShellSnapshot } from "./shell-state";
import { normalizeAgentActionPlan, type AgentActionPlan } from "./agent-action-state";
import type { WorkspaceInstructionsSnapshot } from "./workspace-instructions-state";
import { buildWorkspaceInstructionsPrompt } from "./workspace-instructions-state";

export type ChatMode = "ask" | "planning" | "agent";
export type ChatMessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  accountLabel?: string;
  actionPlan?: AgentActionPlan;
  modelId?: string;
  agentRole?: string;
  timestamp: string;
}

export interface ProviderChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PersistedChatSession {
  mode: ChatMode;
  messages: ChatMessage[];
}

export const chatHistoryStorageNamespace = "opengravity.chat-history.v1";

const validChatModes = new Set<ChatMode>(["ask", "planning", "agent"]);
const validChatRoles = new Set<ChatMessageRole>(["user", "assistant", "system"]);

let nextMessageId = Date.now();

function createMessageId(): string {
  return `chat-${nextMessageId++}`;
}

function normalizeChatMode(value: unknown): ChatMode {
  return typeof value === "string" && validChatModes.has(value as ChatMode) ? (value as ChatMode) : "ask";
}

function normalizeChatMessage(value: unknown, fallbackIndex: number): ChatMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Partial<ChatMessage>;
  const role =
    typeof input.role === "string" && validChatRoles.has(input.role as ChatMessageRole)
      ? (input.role as ChatMessageRole)
      : "assistant";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) {
    return null;
  }

  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : `chat-restored-${fallbackIndex}`,
    role,
    content,
    accountLabel: typeof input.accountLabel === "string" ? input.accountLabel.trim() : undefined,
    actionPlan: normalizeAgentActionPlan(input.actionPlan),
    modelId: typeof input.modelId === "string" ? input.modelId.trim() : undefined,
    agentRole: typeof input.agentRole === "string" ? input.agentRole.trim() : undefined,
    timestamp: typeof input.timestamp === "string" && input.timestamp.trim() ? input.timestamp : new Date().toISOString()
  };
}

export function createChatMessage(
  role: ChatMessageRole,
  content: string,
  metadata: Partial<Pick<ChatMessage, "accountLabel" | "actionPlan" | "agentRole" | "modelId" | "timestamp">> = {}
): ChatMessage {
  return {
    id: createMessageId(),
    role,
    content,
    accountLabel: metadata.accountLabel,
    actionPlan: metadata.actionPlan,
    modelId: metadata.modelId,
    agentRole: metadata.agentRole,
    timestamp: metadata.timestamp ?? new Date().toISOString()
  };
}

export function createInitialChatMessages(): ChatMessage[] {
  return [];
}

export function createDefaultChatSession(): PersistedChatSession {
  return {
    mode: "ask",
    messages: createInitialChatMessages()
  };
}

export function getChatHistoryStorageKey(workspaceRoot: string): string {
  const normalizedWorkspaceRoot = workspaceRoot.trim() || "global";
  return `${chatHistoryStorageNamespace}:${encodeURIComponent(normalizedWorkspaceRoot.toLowerCase())}`;
}

export function normalizePersistedChatSession(input: unknown): PersistedChatSession {
  const defaults = createDefaultChatSession();
  if (!input || typeof input !== "object") {
    return defaults;
  }

  const value = input as Partial<PersistedChatSession>;
  const normalizedMessages = Array.isArray(value.messages)
    ? value.messages
        .map((message, index) => normalizeChatMessage(message, index))
        .filter((message): message is ChatMessage => Boolean(message))
    : [];

  return {
    mode: normalizeChatMode(value.mode),
    messages: normalizedMessages.length > 0 ? normalizedMessages : defaults.messages
  };
}

export function serializePersistedChatSession(session: PersistedChatSession): string {
  return JSON.stringify(session);
}

export function getChatModeDescription(mode: ChatMode): string {
  switch (mode) {
    case "ask":
      return "Answer questions only. Do not propose edits, commands, or workflow execution.";
    case "planning":
      return "Plan the work only. Do not write code, patches, or shell commands.";
    case "agent":
      return "Reason like a coding agent. You may suggest concrete implementation steps and controlled file edits.";
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
  activeFileContent: string,
  workspaceInstructions: WorkspaceInstructionsSnapshot | null = null,
  localToolingContext = ""
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
  const workspaceInstructionSection = buildWorkspaceInstructionsPrompt(workspaceInstructions);

  if (mode === "ask") {
    return [
      ...baseContext,
      "Mode: ASK.",
      "You must answer the user's question directly and conservatively.",
      "Do not propose code edits, do not output patches, do not suggest writing files, and do not suggest running commands unless the user explicitly asks for commands.",
      "Do not include an opengravity-actions block.",
      "Do not act like you changed anything in the workspace.",
      workspaceInstructionSection,
      localToolingContext,
      activeFileSnippet
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (mode === "planning") {
    return [
      ...baseContext,
      "Mode: PLANNING.",
      "You must produce a plan only.",
      "Do not write code, do not output patches, do not generate file contents, do not generate shell commands, and do not claim that any change was made.",
      "Do not include an opengravity-actions block.",
      "Use numbered steps and call out risks, assumptions, and validation steps.",
      workspaceInstructionSection,
      localToolingContext,
      activeFileSnippet
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    ...baseContext,
    "Mode: AGENT.",
    "You may reason about concrete implementation details and propose code-level changes.",
    "However, you are still a chat response in this environment: do not claim to have edited files unless the UI explicitly tells you a change was applied.",
    'When you want the UI to act, append one final ```opengravity-actions code block with strict JSON only.',
    'The JSON schema is {"summary":"...","actions":[{"type":"open_file","path":"..."},{"type":"replace_in_file","path":"...","findText":"...","replaceText":"..."},{"type":"run_command","command":"..."},{"type":"run_workflow","workflow":"recommended"},{"type":"launch_skill","skillId":"...","label":"..."}]}.',
    "Only use replace_in_file when you can target one exact block safely. Prefer unique findText snippets over broad rewrites.",
    "Only use launch_skill when a relevant local tool is already registered in the workspace tool list.",
    "Only include actions that are safe and relevant. Keep the normal explanation outside the JSON block.",
    workspaceInstructionSection,
    localToolingContext,
    activeFileSnippet
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildProviderChatMessages(
  mode: ChatMode,
  snapshot: DesktopShellSnapshot,
  activeFilePath: string,
  activeFileContent: string,
  workspaceInstructions: WorkspaceInstructionsSnapshot | null,
  localToolingContext: string,
  history: ChatMessage[],
  userInput: string
): ProviderChatMessage[] {
  const systemPrompt = buildChatSystemPrompt(
    mode,
    snapshot,
    activeFilePath,
    activeFileContent,
    workspaceInstructions,
    localToolingContext
  );
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


export type AgentActionType = "open_file" | "run_command" | "run_workflow" | "replace_in_file";
export type AgentActionStatus = "idle" | "running" | "completed" | "failed" | "blocked";

export interface AgentSuggestedAction {
  id: string;
  type: AgentActionType;
  label: string;
  command?: string;
  description?: string;
  path?: string;
  workflow?: "recommended";
  findText?: string;
  replaceText?: string;
}

export interface AgentActionPlan {
  id: string;
  summary: string;
  actions: AgentSuggestedAction[];
}

export interface ParsedAgentActionPlan {
  actionPlan?: AgentActionPlan;
  cleanContent: string;
}

const actionFencePattern = /```opengravity-actions\s*([\s\S]*?)```/i;
let nextActionPlanId = 1;

function createActionPlanId(): string {
  return `action-plan-${nextActionPlanId++}`;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeVerbatimString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeActionType(value: unknown): AgentActionType | null {
  return value === "open_file" || value === "run_command" || value === "run_workflow" || value === "replace_in_file"
    ? value
    : null;
}

function createDefaultActionLabel(type: AgentActionType, pathOrCommand: string): string {
  switch (type) {
    case "open_file":
      return pathOrCommand ? `Open ${pathOrCommand}` : "Open file";
    case "run_command":
      return pathOrCommand ? `Run ${pathOrCommand}` : "Run command";
    case "run_workflow":
      return "Run recommended workflow";
    case "replace_in_file":
      return pathOrCommand ? `Edit ${pathOrCommand}` : "Apply file edit";
  }
}

function normalizeAction(input: unknown, index: number): AgentSuggestedAction | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as Partial<AgentSuggestedAction>;
  const type = normalizeActionType(value.type);
  if (!type) {
    return null;
  }

  const path = normalizeString(value.path);
  const command = normalizeString(value.command);
  const workflow = value.workflow === "recommended" ? "recommended" : undefined;
  const findText = normalizeVerbatimString(value.findText);
  const replaceText = normalizeVerbatimString(value.replaceText);

  if (type === "open_file" && !path) {
    return null;
  }

  if (type === "run_command" && !command) {
    return null;
  }

  if (type === "run_workflow" && workflow !== "recommended") {
    return null;
  }

  if (type === "replace_in_file" && (!path || !findText)) {
    return null;
  }

  const labelSeed =
    type === "open_file"
      ? path
      : type === "run_command"
        ? command
        : type === "replace_in_file"
          ? path
          : "recommended workflow";

  return {
    id: normalizeString(value.id) || `agent-action-${index + 1}`,
    type,
    label: normalizeString(value.label) || createDefaultActionLabel(type, labelSeed),
    command: command || undefined,
    description: normalizeString(value.description) || undefined,
    path: path || undefined,
    workflow,
    findText: type === "replace_in_file" ? findText : undefined,
    replaceText: type === "replace_in_file" ? (replaceText ?? "") : undefined
  };
}

export function normalizeAgentActionPlan(input: unknown): AgentActionPlan | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const value = input as Partial<AgentActionPlan> & { actions?: unknown[] };
  const actions = Array.isArray(value.actions)
    ? value.actions
        .map((action, index) => normalizeAction(action, index))
        .filter((action): action is AgentSuggestedAction => Boolean(action))
    : [];

  if (actions.length === 0) {
    return undefined;
  }

  return {
    id: normalizeString(value.id) || createActionPlanId(),
    summary: normalizeString(value.summary) || "Suggested actions from the latest agent response.",
    actions
  };
}

export function extractAgentActionPlan(content: string): ParsedAgentActionPlan {
  const match = content.match(actionFencePattern);
  if (!match) {
    return {
      cleanContent: content.trim()
    };
  }

  const [, payloadText = ""] = match;
  const cleanContent = content.replace(match[0], "").trim();

  try {
    const parsed = JSON.parse(payloadText);
    return {
      actionPlan: normalizeAgentActionPlan(parsed),
      cleanContent
    };
  } catch {
    return {
      cleanContent: content.trim()
    };
  }
}

import type { AgentSuggestedAction } from "./agent-action-state";

export type PermissionAction = "ask" | "allow" | "deny";
export type PermissionProfile = "cautious" | "balanced" | "auto-safe";
export type PermissionSubject = AgentSuggestedAction["type"];

export interface AgentPermissionSettings {
  profile: PermissionProfile;
  rememberedApprovals: string[];
}

export const permissionProfiles: PermissionProfile[] = ["cautious", "balanced", "auto-safe"];
export const permissionSettingsStoragePrefix = "opengravity.agent-permissions.v1";

const validProfiles = new Set<PermissionProfile>(permissionProfiles);
const rememberedWorkflowPattern = "workflow:recommended";
const cautiousAllowPatterns = [
  "pwd",
  "pwd *",
  "ls",
  "ls *",
  "dir",
  "dir *",
  "Get-ChildItem*",
  "rg *",
  "cat *",
  "type *",
  "git status*",
  "git diff*",
  "git log*",
  "git show*"
];
const buildAllowPatterns = [
  "npm run *",
  "pnpm *",
  "yarn *",
  "bun *",
  "cmake *",
  "ctest*",
  "cargo *",
  "go *",
  "dotnet *",
  "python *",
  "pytest*"
];
const denyPatterns = [
  "rm *",
  "rmdir *",
  "del *",
  "erase *",
  "Remove-Item *",
  "taskkill *",
  "Stop-Process *",
  "shutdown *",
  "format *"
];

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesPattern(value: string, pattern: string): boolean {
  return wildcardToRegExp(pattern).test(value);
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function normalizeRememberedApprovals(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];

  for (const entry of input) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = normalizeCommand(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    next.push(normalized);
  }

  return next.slice(0, 24);
}

function isAllowedCommand(command: string, profile: PermissionProfile): boolean {
  const patterns =
    profile === "cautious"
      ? cautiousAllowPatterns
      : [...cautiousAllowPatterns, ...buildAllowPatterns];

  return patterns.some((pattern) => matchesPattern(command, pattern));
}

function isDeniedCommand(command: string): boolean {
  return denyPatterns.some((pattern) => matchesPattern(command, pattern));
}

function getApprovalPatternForAction(action: AgentSuggestedAction): string {
  switch (action.type) {
    case "open_file":
      return "";
    case "run_command":
      return normalizeCommand(action.command ?? "");
    case "run_workflow":
      return action.workflow === "recommended" ? rememberedWorkflowPattern : "";
  }
}

export function createDefaultPermissionSettings(): AgentPermissionSettings {
  return {
    profile: "balanced",
    rememberedApprovals: []
  };
}

export function normalizePermissionSettings(input: unknown): AgentPermissionSettings {
  const defaults = createDefaultPermissionSettings();
  if (!input || typeof input !== "object") {
    return defaults;
  }

  const value = input as Partial<AgentPermissionSettings>;

  return {
    profile:
      typeof value.profile === "string" && validProfiles.has(value.profile as PermissionProfile)
        ? (value.profile as PermissionProfile)
        : defaults.profile,
    rememberedApprovals: normalizeRememberedApprovals(value.rememberedApprovals)
  };
}

export function serializePermissionSettings(settings: AgentPermissionSettings): string {
  return JSON.stringify(settings);
}

export function getPermissionSettingsStorageKey(workspaceRoot: string): string {
  const normalizedRoot = workspaceRoot.trim().toLowerCase() || "workspace";
  return `${permissionSettingsStoragePrefix}.${encodeURIComponent(normalizedRoot)}`;
}

export function getPermissionProfileLabel(profile: PermissionProfile): string {
  switch (profile) {
    case "cautious":
      return "Cautious";
    case "balanced":
      return "Balanced";
    case "auto-safe":
      return "Auto-safe";
  }
}

export function getPermissionProfileDescription(profile: PermissionProfile): string {
  switch (profile) {
    case "cautious":
      return "Open files automatically, but review every command or workflow before it runs.";
    case "balanced":
      return "Auto-run safe read, build, and test commands. Review everything else.";
    case "auto-safe":
      return "Also auto-run the recommended workflow when the action plan stays within safe limits.";
  }
}

export function getPermissionDecisionLabel(decision: PermissionAction): string {
  switch (decision) {
    case "allow":
      return "auto";
    case "deny":
      return "blocked";
    case "ask":
      return "review";
  }
}

export function getRememberedApprovalCount(settings: AgentPermissionSettings): number {
  return settings.rememberedApprovals.length;
}

export function clearRememberedApprovals(settings: AgentPermissionSettings): AgentPermissionSettings {
  return {
    ...settings,
    rememberedApprovals: []
  };
}

export function isRememberedApproval(
  settings: AgentPermissionSettings,
  action: AgentSuggestedAction
): boolean {
  const pattern = getApprovalPatternForAction(action);
  return Boolean(pattern) && settings.rememberedApprovals.includes(pattern);
}

export function rememberAgentActionApproval(
  settings: AgentPermissionSettings,
  action: AgentSuggestedAction
): AgentPermissionSettings {
  const pattern = getApprovalPatternForAction(action);
  if (!pattern || settings.rememberedApprovals.includes(pattern)) {
    return settings;
  }

  return {
    ...settings,
    rememberedApprovals: [pattern, ...settings.rememberedApprovals].slice(0, 24)
  };
}

export function evaluatePermission(
  subject: PermissionSubject,
  target: string,
  settings: AgentPermissionSettings
): PermissionAction {
  switch (subject) {
    case "open_file":
      return "allow";
    case "run_workflow":
      return settings.rememberedApprovals.includes(rememberedWorkflowPattern) || settings.profile === "auto-safe"
        ? "allow"
        : "ask";
    case "run_command": {
      const normalizedCommand = normalizeCommand(target);
      if (!normalizedCommand) {
        return "ask";
      }

      if (isDeniedCommand(normalizedCommand)) {
        return "deny";
      }

      if (settings.rememberedApprovals.includes(normalizedCommand)) {
        return "allow";
      }

      return isAllowedCommand(normalizedCommand, settings.profile) ? "allow" : "ask";
    }
  }
}

export function evaluateAgentActionPermission(
  action: AgentSuggestedAction,
  settings: AgentPermissionSettings
): PermissionAction {
  switch (action.type) {
    case "open_file":
      return evaluatePermission("open_file", action.path ?? "", settings);
    case "run_command":
      return evaluatePermission("run_command", action.command ?? "", settings);
    case "run_workflow":
      return evaluatePermission("run_workflow", action.workflow ?? "", settings);
  }
}

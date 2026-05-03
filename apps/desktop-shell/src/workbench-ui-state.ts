import type { ModelProvider } from "@opengravity/shared-types";

export type WorkbenchSideView = "overview" | "handoff" | "artifacts" | "runtime";
export type WorkbenchBottomView = "build" | "tasks" | "events" | "log" | "terminal";
export type WorkbenchSettingsView = "providers" | "skills" | "integrations";
export type WorkbenchPrimaryView = "source-control" | "explorer" | "agents" | "workflows" | "artifacts" | "search";

export interface WorkbenchUiState {
  activityBarOpen: boolean;
  agentDetailsOpen: boolean;
  bottomOpen: boolean;
  bottomView: WorkbenchBottomView;
  dockOpen: boolean;
  explorerOpen: boolean;
  primaryView: WorkbenchPrimaryView;
  selectedProvider: ModelProvider;
  settingsView: WorkbenchSettingsView;
  sideView: WorkbenchSideView;
  statusBarOpen: boolean;
}

export const workbenchUiStorageKey = "opengravity.workbench-ui.v6";

const validPrimaryViews = new Set<WorkbenchPrimaryView>([
  "source-control",
  "explorer",
  "agents",
  "workflows",
  "artifacts",
  "search"
]);
const validSideViews = new Set<WorkbenchSideView>(["overview", "handoff", "artifacts", "runtime"]);
const validBottomViews = new Set<WorkbenchBottomView>(["build", "tasks", "events", "log", "terminal"]);
const validSettingsViews = new Set<WorkbenchSettingsView>(["providers", "skills", "integrations"]);
const validProviders = new Set<ModelProvider>([
  "anthropic",
  "deepseek",
  "gemini",
  "groq",
  "openai",
  "openrouter",
  "ollama",
  "custom"
]);

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePrimaryView(value: unknown): WorkbenchPrimaryView {
  return typeof value === "string" && validPrimaryViews.has(value as WorkbenchPrimaryView)
    ? (value as WorkbenchPrimaryView)
    : "explorer";
}

function normalizeSideView(value: unknown): WorkbenchSideView {
  return typeof value === "string" && validSideViews.has(value as WorkbenchSideView)
    ? (value as WorkbenchSideView)
    : "overview";
}

function normalizeBottomView(value: unknown): WorkbenchBottomView {
  return typeof value === "string" && validBottomViews.has(value as WorkbenchBottomView)
    ? (value as WorkbenchBottomView)
    : "terminal";
}

function normalizeSettingsView(value: unknown): WorkbenchSettingsView {
  return typeof value === "string" && validSettingsViews.has(value as WorkbenchSettingsView)
    ? (value as WorkbenchSettingsView)
    : "providers";
}

function normalizeProvider(value: unknown): ModelProvider {
  return typeof value === "string" && validProviders.has(value as ModelProvider)
    ? (value as ModelProvider)
    : "gemini";
}

export function createDefaultWorkbenchUiState(): WorkbenchUiState {
  return {
    activityBarOpen: true,
    agentDetailsOpen: false,
    bottomOpen: false,
    bottomView: "terminal",
    dockOpen: true,
    explorerOpen: true,
    primaryView: "explorer",
    selectedProvider: "gemini",
    settingsView: "providers",
    sideView: "overview",
    statusBarOpen: true
  };
}

export function normalizeWorkbenchUiState(input: unknown): WorkbenchUiState {
  const defaults = createDefaultWorkbenchUiState();
  if (!input || typeof input !== "object") {
    return defaults;
  }

  const value = input as Partial<WorkbenchUiState>;

  return {
    activityBarOpen: normalizeBoolean(value.activityBarOpen, defaults.activityBarOpen),
    agentDetailsOpen: normalizeBoolean(value.agentDetailsOpen, defaults.agentDetailsOpen),
    bottomOpen: normalizeBoolean(value.bottomOpen, defaults.bottomOpen),
    bottomView: normalizeBottomView(value.bottomView),
    dockOpen: normalizeBoolean(value.dockOpen, defaults.dockOpen),
    explorerOpen: normalizeBoolean(value.explorerOpen, defaults.explorerOpen),
    primaryView: normalizePrimaryView(value.primaryView),
    selectedProvider: normalizeProvider(value.selectedProvider),
    settingsView: normalizeSettingsView(value.settingsView),
    sideView: normalizeSideView(value.sideView),
    statusBarOpen: normalizeBoolean(value.statusBarOpen, defaults.statusBarOpen)
  };
}

export function serializeWorkbenchUiState(state: WorkbenchUiState): string {
  return JSON.stringify(state);
}

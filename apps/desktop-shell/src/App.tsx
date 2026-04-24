import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { startTransition, useEffect, useMemo, useState } from "react";

import type {
  AgentStatus,
  ModelProvider,
  ProviderHealthState,
  TaskStatus
} from "@opengravity/shared-types";

import {
  configureOpenGravityTheme,
  countDocumentLines,
  detectEditorLanguage,
  formatEditorLanguageLabel
} from "./editor-state";
import {
  browserFallbackRepositorySnapshot,
  browserFallbackWorkspace,
  cancelWorkspaceCommand,
  launchSkillProcess,
  loadRepositorySnapshot,
  loadWorkspaceSnapshot,
  readExternalFile,
  listenToWorkspaceCommands,
  readWorkspaceFile,
  runWorkspaceCommand,
  startWorkspaceCommand,
  writeExternalFile,
  writeWorkspaceFile,
  type WorkspaceSnapshotPayload
} from "./native-bridge";
import {
  createDefaultIntegrationSettings,
  integrationsStorageKey,
  normalizeIntegrationSettings,
  serializeIntegrationSettings,
  type IntegrationSettings
} from "./integrations-state";
import { fetchGitHubRepositorySignals, type GitHubRepositorySignals } from "./github-state";
import {
  addProviderAccount,
  createDefaultWorkbenchSettings,
  getAvailableModelIds,
  getModelsForProvider,
  getPrimaryProviderAccount,
  getProviderAccounts,
  getProviderConnectionLabel,
  getProviderConnectionState,
  getReadyProviderAccounts,
  isProviderReady,
  maskSecret,
  normalizeWorkbenchSettings,
  removeProviderAccount,
  serializeWorkbenchSettings,
  setActiveModel,
  setPrimaryProviderAccount,
  settingsStorageKey,
  updateProviderAccount,
  updateProviderProfile,
  type ProviderAccount,
  type ProviderProfile,
  type WorkbenchSettings
} from "./settings-state";
import {
  parseRepositorySnapshot,
  type ParsedRepositorySnapshot
} from "./repository-state";
import {
  buildProviderChatMessages,
  canRunAgentWorkflow,
  createDefaultChatSession,
  createChatMessage,
  getChatHistoryStorageKey,
  getChatComposerPlaceholder,
  getChatModeDescription,
  normalizePersistedChatSession,
  serializePersistedChatSession,
  type ChatMessage,
  type ChatMode
} from "./chat-state";
import {
  extractAgentActionPlan,
  type AgentActionPlan,
  type AgentActionStatus,
  type AgentSuggestedAction
} from "./agent-action-state";
import {
  appendPermissionRule,
  clearPermissionRules,
  clearRememberedApprovals,
  createDefaultPermissionSettings,
  evaluateAgentActionPermission,
  getCustomPermissionRuleCount,
  getPermissionDecisionLabel,
  getPermissionProfileDescription,
  getPermissionProfileLabel,
  getPermissionRulePatternPlaceholder,
  getPermissionRuleSubjectLabel,
  getPermissionSettingsStorageKey,
  getRememberedApprovalCount,
  normalizePermissionSettings,
  permissionProfiles,
  rememberAgentActionApproval,
  removePermissionRule,
  serializePermissionSettings,
  type AgentPermissionSettings,
  type PermissionAction,
  type PermissionProfile,
  type PermissionRuleSubject
} from "./permission-state";
import {
  fetchOpenRouterCatalog,
  mergeModelCatalog,
  type ProviderCatalogSnapshot
} from "./provider-catalog";
import { buildProviderRadar } from "./provider-radar-state";
import { sendCompatibleChatCompletion } from "./openrouter-chat";
import {
  buildParallelAgentTargets,
  decorateMessagesForParallelTarget
} from "./multiagent-state";
import {
  addLocalSkill,
  normalizeLocalSkills,
  parseSkillArguments,
  removeLocalSkill,
  serializeLocalSkills,
  skillsStorageKey,
  updateLocalSkill,
  type LocalSkill
} from "./skills-state";
import {
  browserFallbackHealth,
  buildDesktopShellSnapshot,
  desktopShellModels,
  type ShellHealth
} from "./shell-state";
import {
  buildWorkspaceCommandPresets,
  createEditorTabList,
  createWorkspaceDocument,
  filterWorkspaceFiles,
  getDirtyWorkspaceDocumentCount,
  getWorkspaceDocument,
  isDocumentDirty,
  labelForFilePath,
  markWorkspaceDocumentSaved,
  updateWorkspaceDocumentContent,
  upsertWorkspaceDocument,
  type WorkspaceDocument,
  type WorkspaceCommandPreset
} from "./workspace-state";
import { TerminalSurface } from "./TerminalSurface";
import {
  appendTerminalSession,
  applyWorkspaceCommandEvent,
  createTerminalSession,
  createTerminalSessionFromResult,
  formatCommandSummary,
  resolveSelectedTerminalRunId,
  type TerminalSession
} from "./terminal-state";
import {
  createDefaultWorkbenchUiState,
  normalizeWorkbenchUiState,
  serializeWorkbenchUiState,
  workbenchUiStorageKey,
  type WorkbenchBottomView,
  type WorkbenchPrimaryView,
  type WorkbenchSettingsView,
  type WorkbenchSideView
} from "./workbench-ui-state";
import {
  applyWorkflowCommandResult,
  applyWorkflowEvent,
  cancelWorkflowRun,
  createWorkflowRun,
  getNextQueuedWorkflowItem,
  getWorkflowProgress,
  markWorkflowItemRunning,
  type WorkflowRun
} from "./workflow-state";
import "./styles.css";

loader.config({ monaco });

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

type MenuId = "file" | "edit" | "selection" | "view" | "go" | "run" | "terminal" | "help";

interface ExplorerGroup {
  label: string;
  entries: string[];
}

const menuItems: Array<{ id: MenuId; label: string }> = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "selection", label: "Selection" },
  { id: "view", label: "View" },
  { id: "go", label: "Go" },
  { id: "run", label: "Run" },
  { id: "terminal", label: "Terminal" },
  { id: "help", label: "Help" }
];

const activityItems: Array<{ id: WorkbenchPrimaryView; shortLabel: string; label: string }> = [
  { id: "source-control", shortLabel: "SC", label: "Source Control" },
  { id: "explorer", shortLabel: "EX", label: "Explorer" },
  { id: "agents", shortLabel: "AG", label: "Agents" },
  { id: "workflows", shortLabel: "WF", label: "Workflows" },
  { id: "artifacts", shortLabel: "AR", label: "Artifacts" },
  { id: "search", shortLabel: "SR", label: "Search" }
];

const approvalProfiles = permissionProfiles;

const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fontFamily: '"Cascadia Code", Consolas, monospace',
  fontLigatures: true,
  fontSize: 13,
  minimap: { enabled: false },
  padding: { top: 14 },
  renderLineHighlight: "line",
  renderWhitespace: "selection",
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  tabSize: 2
};

function loadWorkbenchSettings(): WorkbenchSettings {
  const defaults = createDefaultWorkbenchSettings(desktopShellModels);
  if (typeof window === "undefined" || !window.localStorage) {
    return defaults;
  }

  try {
    const rawValue = window.localStorage.getItem(settingsStorageKey);
    if (!rawValue) {
      return defaults;
    }

    return normalizeWorkbenchSettings(JSON.parse(rawValue), desktopShellModels);
  } catch {
    return defaults;
  }
}

function loadLocalSkills(): LocalSkill[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(skillsStorageKey);
    if (!rawValue) {
      return [];
    }

    return normalizeLocalSkills(JSON.parse(rawValue));
  } catch {
    return [];
  }
}

function loadIntegrationSettings(): IntegrationSettings {
  const defaults = createDefaultIntegrationSettings();
  if (typeof window === "undefined" || !window.localStorage) {
    return defaults;
  }

  try {
    const rawValue = window.localStorage.getItem(integrationsStorageKey);
    if (!rawValue) {
      return defaults;
    }

    return normalizeIntegrationSettings(JSON.parse(rawValue));
  } catch {
    return defaults;
  }
}

function loadWorkbenchUiState() {
  const defaults = createDefaultWorkbenchUiState();
  if (typeof window === "undefined" || !window.localStorage) {
    return defaults;
  }

  try {
    const rawValue = window.localStorage.getItem(workbenchUiStorageKey);
    if (!rawValue) {
      return defaults;
    }

    return normalizeWorkbenchUiState(JSON.parse(rawValue));
  } catch {
    return defaults;
  }
}

function loadPermissionSettings(workspaceRoot: string): AgentPermissionSettings {
  const defaults = createDefaultPermissionSettings();
  if (typeof window === "undefined" || !window.localStorage) {
    return defaults;
  }

  try {
    const rawValue = window.localStorage.getItem(getPermissionSettingsStorageKey(workspaceRoot));
    if (!rawValue) {
      return defaults;
    }

    return normalizePermissionSettings(JSON.parse(rawValue));
  } catch {
    return defaults;
  }
}

function isExternalDocumentPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function normalizePathSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

function isCompatibleChatProvider(provider: ModelProvider): boolean {
  return (
    provider === "gemini" ||
    provider === "groq" ||
    provider === "openrouter" ||
    provider === "openai" ||
    provider === "custom"
  );
}

async function loadShellHealth(): Promise<ShellHealth> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ShellHealth>("shell_health");
  } catch {
    return browserFallbackHealth;
  }
}

const taskTone = (status: TaskStatus): string => {
  switch (status) {
    case "completed":
      return "is-done";
    case "running":
      return "is-running";
    case "blocked":
      return "is-blocked";
    case "failed":
      return "is-failed";
    default:
      return "is-waiting";
  }
};

const providerTone = (state: ProviderHealthState): string => {
  switch (state) {
    case "healthy":
      return "is-done";
    case "degraded":
      return "is-running";
    case "rate_limited":
      return "is-blocked";
    case "offline":
      return "is-failed";
  }
};

const connectionTone = (profile: ProviderProfile, settings: WorkbenchSettings): string => {
  switch (getProviderConnectionState(profile, settings)) {
    case "ready":
      return "is-done";
    case "missing-base-url":
    case "missing-api-key":
      return "is-blocked";
    case "disabled":
      return "is-waiting";
  }
};

const agentTone = (status: AgentStatus): string => {
  switch (status) {
    case "busy":
      return "is-running";
    case "offline":
      return "is-failed";
    default:
      return "is-waiting";
  }
};

const actionStatusTone = (status: AgentActionStatus): string => {
  switch (status) {
    case "running":
      return taskTone("running");
    case "completed":
      return taskTone("completed");
    case "blocked":
      return taskTone("blocked");
    case "failed":
      return taskTone("failed");
    default:
      return taskTone("queued");
  }
};

const permissionDecisionTone = (decision: PermissionAction): string => {
  switch (decision) {
    case "allow":
      return "is-done";
    case "deny":
      return "is-blocked";
    case "ask":
      return "is-waiting";
  }
};

const repositoryReadinessTone = (readiness: "ready" | "review" | "blocked"): string => {
  switch (readiness) {
    case "ready":
      return "is-done";
    case "blocked":
      return "is-blocked";
    case "review":
      return "is-running";
  }
};

function buildExplorerGroups(paths: string[]): ExplorerGroup[] {
  const groups = new Map<string, string[]>();

  for (const path of paths) {
    const parts = path.split("/");
    const head = parts[0];
    const rest = parts.slice(1);
    const key = rest.length === 0 ? "root" : head;
    const value = rest.length === 0 ? head : rest.join("/");
    const existing = groups.get(key) ?? [];
    existing.push(value);
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([label, entries]) => ({
    label,
    entries
  }));
}

export default function App() {
  const [shellHealth, setShellHealth] = useState<ShellHealth>(browserFallbackHealth);
  const [settings, setSettings] = useState<WorkbenchSettings>(() => loadWorkbenchSettings());
  const [integrations, setIntegrations] = useState<IntegrationSettings>(() => loadIntegrationSettings());
  const [workspace, setWorkspace] = useState<WorkspaceSnapshotPayload>(browserFallbackWorkspace);
  const [repository, setRepository] = useState<ParsedRepositorySnapshot>(() =>
    parseRepositorySnapshot(browserFallbackRepositorySnapshot)
  );
  const [activeFilePath, setActiveFilePath] = useState(browserFallbackWorkspace.activeFilePath);
  const [openDocuments, setOpenDocuments] = useState<WorkspaceDocument[]>([
    createWorkspaceDocument(browserFallbackWorkspace.activeFilePath, browserFallbackWorkspace.activeFileContent)
  ]);
  const [openMenuId, setOpenMenuId] = useState<MenuId | null>(null);
  const [primaryView, setPrimaryView] = useState<WorkbenchPrimaryView>(() => loadWorkbenchUiState().primaryView);
  const [sideView, setSideView] = useState<WorkbenchSideView>(() => loadWorkbenchUiState().sideView);
  const [bottomView, setBottomView] = useState<WorkbenchBottomView>(() => loadWorkbenchUiState().bottomView);
  const [bottomOpen, setBottomOpen] = useState(() => loadWorkbenchUiState().bottomOpen);
  const [activityBarOpen, setActivityBarOpen] = useState(() => loadWorkbenchUiState().activityBarOpen);
  const [explorerOpen, setExplorerOpen] = useState(() => loadWorkbenchUiState().explorerOpen);
  const [dockOpen, setDockOpen] = useState(() => loadWorkbenchUiState().dockOpen);
  const [statusBarOpen, setStatusBarOpen] = useState(() => loadWorkbenchUiState().statusBarOpen);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<WorkbenchSettingsView>(() => loadWorkbenchUiState().settingsView);
  const [selectedProvider, setSelectedProvider] = useState<ModelProvider>(() => loadWorkbenchUiState().selectedProvider);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedSkillId, setSelectedSkillId] = useState<string>("");
  const [skills, setSkills] = useState<LocalSkill[]>(() => loadLocalSkills());
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [activeTerminalRunId, setActiveTerminalRunId] = useState<string | null>(null);
  const [selectedTerminalRunId, setSelectedTerminalRunId] = useState<string | null>(null);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [openRouterCatalog, setOpenRouterCatalog] = useState<ProviderCatalogSnapshot | null>(null);
  const [providerCatalogBusy, setProviderCatalogBusy] = useState<ModelProvider | null>(null);
  const [providerCatalogError, setProviderCatalogError] = useState<string | null>(null);
  const [agentDetailsOpen, setAgentDetailsOpen] = useState(() => loadWorkbenchUiState().agentDetailsOpen);
  const [repositoryBusy, setRepositoryBusy] = useState(false);
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubSignals, setGithubSignals] = useState<GitHubRepositorySignals | null>(null);
  const [chatMode, setChatMode] = useState<ChatMode>(() => createDefaultChatSession().mode);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => createDefaultChatSession().messages);
  const [chatHistoryReady, setChatHistoryReady] = useState(false);
  const [loadedChatHistoryKey, setLoadedChatHistoryKey] = useState("");
  const [permissionSettings, setPermissionSettings] = useState<AgentPermissionSettings>(() =>
    loadPermissionSettings(browserFallbackWorkspace.rootPath)
  );
  const [permissionRuleSubjectDraft, setPermissionRuleSubjectDraft] = useState<PermissionRuleSubject>("run_command");
  const [permissionRulePatternDraft, setPermissionRulePatternDraft] = useState("");
  const [permissionRuleActionDraft, setPermissionRuleActionDraft] = useState<PermissionAction>("allow");
  const [agentActionStatuses, setAgentActionStatuses] = useState<Record<string, AgentActionStatus>>({});
  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null);
  const [workflowDispatchBusy, setWorkflowDispatchBusy] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("Loading workspace...");
  const [explorerQuery, setExplorerQuery] = useState("");
  const permissionSettingsKey = useMemo(
    () => getPermissionSettingsStorageKey(workspace.rootPath || browserFallbackWorkspace.rootPath),
    [workspace.rootPath]
  );
  const chatHistoryKey = useMemo(
    () => getChatHistoryStorageKey(workspace.rootPath || browserFallbackWorkspace.rootPath),
    [workspace.rootPath]
  );

  useEffect(() => {
    void loadShellHealth().then((nextHealth) => {
      startTransition(() => setShellHealth(nextHealth));
    });

    void loadWorkspaceSnapshot().then((nextWorkspace) => {
      startTransition(() => {
        setWorkspace(nextWorkspace);
        setActiveFilePath(nextWorkspace.activeFilePath);
        setOpenDocuments([
          createWorkspaceDocument(nextWorkspace.activeFilePath, nextWorkspace.activeFileContent)
        ]);
        setWorkspaceNotice(`Loaded ${nextWorkspace.files.length} workspace files.`);
      });
    });

    void loadRepositorySnapshot().then((nextRepository) => {
      startTransition(() => {
        setRepository(parseRepositorySnapshot(nextRepository));
      });
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    void listenToWorkspaceCommands((payload) => {
      if (disposed) {
        return;
      }

      startTransition(() => {
        setTerminalSessions((current) => applyWorkspaceCommandEvent(current, payload));
        setWorkflowRun((current) => (current ? applyWorkflowEvent(current, payload) : current));

        if (payload.kind === "completed" || payload.kind === "cancelled" || payload.kind === "launch-failed") {
          setActiveTerminalRunId((current) => (current === payload.runId ? null : current));
          setWorkspaceNotice(payload.message ?? `Command finished: ${payload.command}`);
        }
      });
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(settingsStorageKey, serializeWorkbenchSettings(settings));
  }, [settings]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(skillsStorageKey, serializeLocalSkills(skills));
  }, [skills]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(integrationsStorageKey, serializeIntegrationSettings(integrations));
  }, [integrations]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(
      workbenchUiStorageKey,
      serializeWorkbenchUiState({
        activityBarOpen,
        agentDetailsOpen,
        bottomOpen,
        bottomView,
        dockOpen,
        explorerOpen,
        primaryView,
        selectedProvider,
        settingsView,
        sideView,
        statusBarOpen
      })
    );
  }, [
    activityBarOpen,
    agentDetailsOpen,
    bottomOpen,
    bottomView,
    dockOpen,
    explorerOpen,
    primaryView,
    selectedProvider,
    settingsView,
    sideView,
    statusBarOpen
  ]);

  useEffect(() => {
    setPermissionSettings(loadPermissionSettings(workspace.rootPath || browserFallbackWorkspace.rootPath));
  }, [permissionSettingsKey, workspace.rootPath]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(permissionSettingsKey, serializePermissionSettings(permissionSettings));
  }, [permissionSettings, permissionSettingsKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) {
      setChatHistoryReady(true);
      setLoadedChatHistoryKey(chatHistoryKey);
      return;
    }

    try {
      const rawValue = window.localStorage.getItem(chatHistoryKey);
      const session = rawValue ? normalizePersistedChatSession(JSON.parse(rawValue)) : createDefaultChatSession();
      setChatMode(session.mode);
      setChatMessages(session.messages);
      setAgentActionStatuses({});
      setLoadedChatHistoryKey(chatHistoryKey);
    } catch {
      const fallbackSession = createDefaultChatSession();
      setChatMode(fallbackSession.mode);
      setChatMessages(fallbackSession.messages);
      setAgentActionStatuses({});
      setLoadedChatHistoryKey(chatHistoryKey);
    } finally {
      setChatHistoryReady(true);
    }
  }, [chatHistoryKey]);

  useEffect(() => {
    if (
      !chatHistoryReady ||
      loadedChatHistoryKey !== chatHistoryKey ||
      typeof window === "undefined" ||
      !window.localStorage
    ) {
      return;
    }

    window.localStorage.setItem(
      chatHistoryKey,
      serializePersistedChatSession({
        mode: chatMode,
        messages: chatMessages
      })
    );
  }, [chatHistoryKey, chatHistoryReady, chatMessages, chatMode, loadedChatHistoryKey]);

  useEffect(() => {
    if (!settings.providerProfiles.some((profile) => profile.provider === selectedProvider)) {
      setSelectedProvider(settings.providerProfiles[0]?.provider ?? "gemini");
    }
  }, [selectedProvider, settings.providerProfiles]);

  useEffect(() => {
    if (!openMenuId) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        setOpenMenuId(null);
        return;
      }

      if (!target.closest(".menu-item-shell")) {
        setOpenMenuId(null);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [openMenuId]);

  useEffect(() => {
    const primaryAccount = getPrimaryProviderAccount(settings, selectedProvider);
    const selectedProviderAccounts = getProviderAccounts(settings, selectedProvider);

    if (!selectedProviderAccounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(primaryAccount?.id ?? selectedProviderAccounts[0]?.id ?? "");
    }
  }, [selectedAccountId, selectedProvider, settings]);

  useEffect(() => {
    if (!skills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(skills[0]?.id ?? "");
    }
  }, [selectedSkillId, skills]);

  const modelCatalog = useMemo(() => {
    const merged = mergeModelCatalog(desktopShellModels, openRouterCatalog?.models ?? []);
    const customProfile = settings.providerProfiles.find((profile) => profile.provider === "custom");
    const customModelId = customProfile?.preferredModelId.trim() ?? "";

    if (customModelId && !merged.some((model) => model.id === customModelId)) {
      merged.push({
        id: customModelId,
        label: customModelId,
        provider: "custom",
        qualityTier: "balanced",
        costTier: "medium",
        supportsTools: true,
        maxContextWindow: 128000
      });
    }

    return merged;
  }, [openRouterCatalog, settings.providerProfiles]);
  const snapshot = useMemo(
    () => buildDesktopShellSnapshot(shellHealth, settings, modelCatalog),
    [modelCatalog, shellHealth, settings]
  );
  const workflowTemplate = useMemo(() => createWorkflowRun(snapshot.executionPlan), [snapshot.executionPlan]);
  const filteredWorkspaceFiles = useMemo(
    () => filterWorkspaceFiles(workspace.files, explorerQuery),
    [explorerQuery, workspace.files]
  );
  const explorerGroups = useMemo(() => buildExplorerGroups(filteredWorkspaceFiles), [filteredWorkspaceFiles]);
  const commandPresets = useMemo(() => buildWorkspaceCommandPresets(workspace.files), [workspace.files]);
  const editorTabs = useMemo(
    () => createEditorTabList(activeFilePath, openDocuments.map((document) => document.path)),
    [activeFilePath, openDocuments]
  );
  const availableModelIds = useMemo(() => new Set(getAvailableModelIds(settings, snapshot.models)), [settings, snapshot.models]);
  const activeLiveModel = useMemo(
    () => snapshot.models.find((model) => model.id === settings.activeModelId && availableModelIds.has(model.id)),
    [availableModelIds, settings.activeModelId, snapshot.models]
  );
  const readyProviders = useMemo(
    () => settings.providerProfiles.filter((profile) => isProviderReady(profile, settings)),
    [settings]
  );
  const selectedProfile = settings.providerProfiles.find((profile) => profile.provider === selectedProvider) ?? settings.providerProfiles[0];
  const compatibleChatProfiles = useMemo(
    () => settings.providerProfiles.filter((profile) => isCompatibleChatProvider(profile.provider)),
    [settings.providerProfiles]
  );
  const selectedChatProfile =
    compatibleChatProfiles.find((profile) => profile.provider === selectedProvider) ?? compatibleChatProfiles[0];
  const selectedProviderModels = selectedProfile ? getModelsForProvider(snapshot.models, selectedProfile.provider) : [];
  const selectedProviderAccounts = selectedProfile ? getProviderAccounts(settings, selectedProfile.provider) : [];
  const selectedPrimaryAccount = selectedProfile
    ? getPrimaryProviderAccount(settings, selectedProfile.provider)
    : undefined;
  const selectedReadyAccounts = selectedProfile
    ? getReadyProviderAccounts(settings, selectedProfile.provider)
    : [];
  const selectedAccount =
    selectedProviderAccounts.find((account) => account.id === selectedAccountId) ??
    selectedPrimaryAccount ??
    selectedProviderAccounts[0];
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
  const selectedProviderCatalogBusy = providerCatalogBusy === selectedProfile?.provider;
  const selectedProviderSupportsCatalog = selectedProfile?.provider === "openrouter";
  const openRouterFreeModels = useMemo(
    () => openRouterCatalog?.models.filter((model) => model.isFree) ?? [],
    [openRouterCatalog]
  );
  const recentEvents = snapshot.sessionRecord.events.slice(-6).reverse();
  const recentArtifacts = snapshot.sessionRecord.artifacts.slice(-4).reverse();
  const runningTask = snapshot.tasks.find((task) => task.status === "running");
  const activeModelLabel = activeLiveModel?.label ?? settings.activeModelId ?? "Setup required";
  const activeChatProfile = activeLiveModel
    ? settings.providerProfiles.find((profile) => profile.provider === activeLiveModel.provider)
    : undefined;
  const fallbackChatProfile = settings.providerProfiles.find(
    (profile) => isCompatibleChatProvider(profile.provider) && getReadyProviderAccounts(settings, profile.provider).length > 0
  );
  const chatProfile =
    activeChatProfile && isCompatibleChatProvider(activeChatProfile.provider)
      ? activeChatProfile
      : selectedChatProfile && isCompatibleChatProvider(selectedChatProfile.provider)
        ? selectedChatProfile
        : fallbackChatProfile;
  const chatAccounts = chatProfile ? getReadyProviderAccounts(settings, chatProfile.provider) : [];
  const chatModelId =
    chatProfile && activeLiveModel && chatProfile.provider === activeLiveModel.provider
      ? activeLiveModel.id
      : chatProfile?.preferredModelId ?? "";
  const chatProviderLabel = chatProfile?.label ?? "Provider";
  const providerRadar = useMemo(
    () => buildProviderRadar(settings, snapshot.providerHealth, snapshot.models),
    [settings, snapshot.models, snapshot.providerHealth]
  );
  const rememberedApprovalCount = getRememberedApprovalCount(permissionSettings);
  const customRuleCount = getCustomPermissionRuleCount(permissionSettings);
  const quickSetupProfile = selectedChatProfile;
  const quickSetupAccounts = quickSetupProfile ? getProviderAccounts(settings, quickSetupProfile.provider) : [];
  const quickSetupModels = quickSetupProfile ? getModelsForProvider(snapshot.models, quickSetupProfile.provider) : [];
  const quickSetupAccount =
    quickSetupAccounts.find((account) => account.id === selectedAccountId) ??
    (quickSetupProfile ? getPrimaryProviderAccount(settings, quickSetupProfile.provider) : undefined) ??
    quickSetupAccounts[0];
  const showQuickBaseUrl = Boolean(
    quickSetupProfile &&
      (quickSetupProfile.provider === "custom" ||
        quickSetupProfile.provider === "openrouter" ||
        quickSetupProfile.provider === "ollama")
  );
  const activeDocument = getWorkspaceDocument(openDocuments, activeFilePath);
  const activeDocumentLanguage = detectEditorLanguage(activeFilePath);
  const activeDocumentLanguageLabel = formatEditorLanguageLabel(activeDocumentLanguage);
  const activeDocumentLineCount = countDocumentLines(activeDocument?.currentContent ?? "");
  const editorDirty = activeDocument
    ? isDocumentDirty(activeDocument.savedContent, activeDocument.currentContent)
    : false;
  const dirtyDocumentCount = getDirtyWorkspaceDocumentCount(openDocuments);
  const terminalBusy = activeTerminalRunId !== null;
  const activeTerminalSession = terminalSessions.find((session) => session.runId === activeTerminalRunId) ?? null;
  const selectedTerminalSession =
    terminalSessions.find((session) => session.runId === selectedTerminalRunId) ?? terminalSessions[0] ?? null;
  const workflowProgress = workflowRun ? getWorkflowProgress(workflowRun) : null;
  const repositoryHasChanges = repository.changes.length > 0;
  const githubRemote = repository.githubRemote;
  const workspaceDisplayName = labelForFilePath(workspace.rootPath || "Workspace");
  const githubSignalsLabel = githubSignals
    ? `${githubSignals.pulls.length} PRs · ${githubSignals.issues.length} issues`
    : githubRemote
      ? "Refresh GitHub"
      : "No GitHub remote";
  const highlightedPulls = githubSignals?.pulls.slice(0, 2) ?? [];
  const highlightedIssues = githubSignals?.issues.slice(0, 3) ?? [];
  const normalizedSettings = useMemo(
    () => normalizeWorkbenchSettings(settings, modelCatalog),
    [modelCatalog, settings]
  );
  const workbenchClassName = [
    "workbench",
    !activityBarOpen && "is-activity-collapsed",
    !explorerOpen && "is-explorer-collapsed",
    !dockOpen && "is-dock-collapsed"
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    setWorkflowRun(workflowTemplate);
  }, [workflowTemplate]);

  useEffect(() => {
    if (serializeWorkbenchSettings(settings) === serializeWorkbenchSettings(normalizedSettings)) {
      return;
    }

    setSettings(normalizedSettings);
  }, [normalizedSettings, settings]);

  useEffect(() => {
    if (!githubRemote || !integrations.githubAutoRefresh) {
      return;
    }

    let disposed = false;

    void (async () => {
      try {
        const nextSignals = await fetchGitHubRepositorySignals(githubRemote, integrations.githubToken);
        if (disposed) {
          return;
        }

        startTransition(() => {
          setGithubSignals(nextSignals);
          setGithubError(null);
        });
      } catch (error) {
        if (disposed) {
          return;
        }

        const message = error instanceof Error ? error.message : "GitHub refresh failed.";
        startTransition(() => {
          setGithubSignals(null);
          setGithubError(message);
        });
      }
    })();

    return () => {
      disposed = true;
    };
  }, [githubRemote, integrations.githubAutoRefresh, integrations.githubToken]);

  useEffect(() => {
    if (!terminalInput && commandPresets[0]) {
      setTerminalInput(commandPresets[0].command);
    }
  }, [commandPresets, terminalInput]);

  useEffect(() => {
    setSelectedTerminalRunId((current) =>
      resolveSelectedTerminalRunId(terminalSessions, current, activeTerminalRunId)
    );
  }, [activeTerminalRunId, terminalSessions]);

  useEffect(() => {
    if (!workflowRun || workflowRun.status !== "running" || workflowRun.currentRunId || terminalBusy || workflowDispatchBusy) {
      return;
    }

    const nextItem = getNextQueuedWorkflowItem(workflowRun);
    if (!nextItem) {
      return;
    }

    setWorkflowDispatchBusy(true);
    void launchCommand(nextItem.command, nextItem.id).finally(() => {
      setWorkflowDispatchBusy(false);
    });
  }, [terminalBusy, workflowDispatchBusy, workflowRun]);

  useEffect(() => {
    if (!workflowRun || workflowRun.currentRunId) {
      return;
    }

    if (workflowRun.status === "completed") {
      setWorkspaceNotice("Recommended workflow completed.");
    } else if (workflowRun.status === "failed") {
      setWorkspaceNotice("Recommended workflow stopped after a failed step.");
    } else if (workflowRun.status === "cancelled") {
      setWorkspaceNotice("Recommended workflow was cancelled.");
    }
  }, [workflowRun]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveFile();
        return;
      }

      if (event.key === "Escape") {
        setOpenMenuId(null);
        setLayoutOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.__TAURI__) {
      return;
    }

    let disposed = false;
    let unlisten = () => {};

    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      if (disposed) {
        return;
      }

      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type !== "drop") {
          return;
        }

        const workspaceRoot = normalizePathSlashes(workspace.rootPath).replace(/\/+$/, "").toLowerCase();
        void (async () => {
          for (const droppedPath of payload.paths) {
            const normalizedDroppedPath = normalizePathSlashes(droppedPath);
            const loweredPath = normalizedDroppedPath.toLowerCase();

            if (workspaceRoot && loweredPath.startsWith(`${workspaceRoot}/`)) {
              await loadActiveFile(normalizedDroppedPath.slice(workspaceRoot.length + 1));
              continue;
            }

            try {
              const file = await readExternalFile(droppedPath);
              startTransition(() => {
                setActiveFilePath(file.path);
                setOpenDocuments((current) =>
                  upsertWorkspaceDocument(current, createWorkspaceDocument(file.path, file.content))
                );
                setWorkspaceNotice(`Opened dropped file ${labelForFilePath(file.path)}`);
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : `Failed to open ${droppedPath}`;
              startTransition(() => setWorkspaceNotice(message));
            }
          }
        })();
      });
    });

    return () => {
      disposed = true;
      unlisten();
    };
  }, [workspace.rootPath]);

  const loadActiveFile = async (relativePath: string) => {
    setWorkspaceBusy(true);

    try {
      const file = isExternalDocumentPath(relativePath)
        ? await readExternalFile(relativePath)
        : await readWorkspaceFile(relativePath);
      startTransition(() => {
        setActiveFilePath(file.path);
        setOpenDocuments((current) =>
          upsertWorkspaceDocument(current, createWorkspaceDocument(file.path, file.content))
        );
        setWorkspaceNotice(`Opened ${file.path}`);
      });
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const renderPrimaryPane = () => {
    switch (primaryView) {
      case "explorer":
        return (
          <>
            <div className="pane-header">
              <span>Explorer</span>
              <span className="pane-meta">{workspace.files.length} workspace files</span>
            </div>

            <div className="pane-scroll">
              <section className="section-block">
                <div className="section-label">Open editors</div>
                <div className="flat-list">
                  {editorTabs.map((tabPath) => (
                    <button
                      className={`flat-list-row ${tabPath === activeFilePath ? "is-active" : ""}`}
                      key={tabPath}
                      onClick={() => void handleSelectFile(tabPath)}
                      type="button"
                    >
                      <span>{labelForFilePath(tabPath)}</span>
                      {isDocumentDirty(
                        getWorkspaceDocument(openDocuments, tabPath)?.savedContent ?? "",
                        getWorkspaceDocument(openDocuments, tabPath)?.currentContent ?? ""
                      ) ? <span className="dirty-dot" /> : null}
                    </button>
                  ))}
                </div>
              </section>

              <section className="section-block">
                <div className="section-label">Workspace</div>
                <div className="explorer-search">
                  <input
                    className="explorer-search-input"
                    onChange={(event) => setExplorerQuery(event.target.value)}
                    placeholder="Filter workspace files"
                    value={explorerQuery}
                  />
                </div>
                <div className="tree-root">{workspace.rootPath}</div>
                {explorerGroups.map((group) => (
                  <div className="tree-group" key={group.label}>
                    <div className={`tree-item ${group.label === "root" ? "is-root-group" : "is-folder"}`}>
                      <span>{group.label === "root" ? "root" : group.label}</span>
                    </div>
                    <div className="tree-children">
                      {group.entries.map((entry) => {
                        const absolutePath = group.label === "root" ? entry : `${group.label}/${entry}`;
                        return (
                          <button
                            className={`tree-item is-file ${absolutePath === activeFilePath ? "is-active" : ""}`}
                            key={absolutePath}
                            onClick={() => void handleSelectFile(absolutePath)}
                            type="button"
                          >
                            <span>{entry}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </>
        );
      case "source-control":
        return (
          <>
            <div className="pane-header">
              <span>Source Control</span>
              <span className="pane-meta">
                {repository.available ? `${repository.changes.length} changes` : "No git metadata"}
              </span>
            </div>

            <div className="pane-scroll">
              <section className="section-block compact-section-block">
                <div className="source-control-toolbar">
                  <div className="source-control-branch">
                    <strong>{repository.branch || "No branch"}</strong>
                    <span>{repository.available ? repository.trackingSummary : "Git metadata unavailable"}</span>
                  </div>
                  <div className="settings-inline-actions">
                    <button
                      className="secondary-button slim-button"
                      disabled={!repository.available || repositoryBusy}
                      onClick={() => void handleRefreshRepository()}
                      type="button"
                    >
                      {repositoryBusy ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                </div>

                <div className="source-control-radar">
                  <div className="summary-card">
                    <strong>{repository.radar.readinessLabel}</strong>
                    <p>{repository.radar.summary}</p>
                    <span className={`state-pill ${repositoryReadinessTone(repository.radar.readiness)}`}>
                      {repository.radar.totalChanges === 0 ? "clean" : `${repository.radar.totalChanges} changes`}
                    </span>
                  </div>

                  <div className="summary-card">
                    <strong>Working tree</strong>
                    <p>
                      {`${repository.radar.stagedCount} staged · ${repository.radar.unstagedCount} unstaged · ${repository.radar.untrackedCount} untracked`}
                    </p>
                    <span
                      className={`state-pill ${
                        repository.radar.conflictedCount > 0
                          ? "is-blocked"
                          : repository.radar.stagedCount > 0 && repository.radar.unstagedCount === 0
                            ? "is-done"
                            : "is-running"
                      }`}
                    >
                      {repository.radar.conflictedCount > 0
                        ? `${repository.radar.conflictedCount} conflicts`
                        : repository.radar.stagedCount > 0 && repository.radar.unstagedCount === 0
                          ? `${repository.radar.stagedCount} staged`
                          : "review local changes"}
                    </span>
                  </div>

                  <div className="summary-card">
                    <strong>GitHub</strong>
                    <p>
                      {githubRemote
                        ? `${githubRemote.owner}/${githubRemote.repo}`
                        : "No GitHub remote detected for this workspace yet."}
                    </p>
                    <span className={`state-pill ${githubRemote ? "is-done" : "is-waiting"}`}>
                      {githubSignalsLabel}
                    </span>
                  </div>
                </div>
              </section>

              <section className="section-block compact-section-block">
                <div className="settings-section-headline">
                  <div>
                    <div className="section-label">Commit plan</div>
                    <div className="settings-provider-copy">
                      Use the generated title as a starting point, then verify the ship path before you commit.
                    </div>
                  </div>
                  <div className="settings-inline-actions">
                    <button
                      className="secondary-button slim-button"
                      disabled={!repositoryHasChanges}
                      onClick={() => void handleCopyCommitSuggestion()}
                      type="button"
                    >
                      Copy commit title
                    </button>
                  </div>
                </div>

                <div className="summary-card">
                  <strong>{repository.commitSuggestion}</strong>
                  <p>{repository.insights[0]?.detail ?? "No commit insight is available yet."}</p>
                  <div className="source-control-meta-grid">
                    <span>{repository.trackingSummary}</span>
                    <span>{repository.commits.length > 0 ? `${repository.commits.length} recent commits loaded` : "No recent commits yet"}</span>
                  </div>
                </div>

                {repository.commits.length > 0 ? (
                  <div className="compact-list compact-list-tight">
                    {repository.commits.slice(0, 3).map((commit) => (
                      <div className="compact-row" key={commit.sha}>
                        <div className="compact-copy">
                          <strong>{commit.summary}</strong>
                          <span>{commit.shortSha}</span>
                        </div>
                        <span className="state-pill is-waiting">{commit.relativeTime || "recent"}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="section-block compact-section-block">
                <div className="section-label">Repository radar</div>
                <div className="compact-list compact-list-tight">
                  {repository.insights.map((insight) => (
                    <div className="compact-row" key={insight.title}>
                      <div className="compact-copy">
                        <strong>{insight.title}</strong>
                        <span>{insight.detail}</span>
                      </div>
                      <span className={`state-pill ${insight.tone === "good" ? "is-done" : insight.tone === "warn" ? "is-blocked" : "is-running"}`}>
                        {insight.tone}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="section-block compact-section-block">
                <div className="section-label">Next actions</div>
                <div className="compact-list compact-list-tight">
                  {repository.nextActions.map((entry) => (
                    <div className="compact-row" key={entry}>
                      <div className="compact-copy">
                        <strong>{entry}</strong>
                        <span>Recommended ship step</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="section-block compact-section-block">
                <div className="settings-section-headline">
                  <div>
                    <div className="section-label">GitHub signals</div>
                    <div className="settings-provider-copy">
                      Pull requests and issues stay visible here so you do not need a browser tab for basic repo awareness.
                    </div>
                  </div>
                  <button
                    className="secondary-button slim-button"
                    disabled={!githubRemote || githubBusy}
                    onClick={() => void handleRefreshGitHub()}
                    type="button"
                  >
                    {githubBusy ? "Refreshing..." : "Refresh GitHub"}
                  </button>
                </div>
                {githubError ? <div className="workflow-warning">{githubError}</div> : null}
                {!githubRemote ? (
                  <div className="settings-empty-state">No GitHub remote detected for this workspace.</div>
                ) : highlightedPulls.length === 0 && highlightedIssues.length === 0 ? (
                  <div className="settings-empty-state">Refresh GitHub to pull live pull requests and issues.</div>
                ) : (
                  <div className="compact-list compact-list-tight">
                    {highlightedPulls.map((item) => (
                      <div className="compact-row" key={`pull-${item.number}`}>
                        <div className="compact-copy">
                          <strong>{`PR #${item.number} · ${item.title}`}</strong>
                          <span>{`${item.author} · ${item.updatedAt}`}</span>
                        </div>
                        <span className={`state-pill ${item.isDraft ? "is-running" : "is-done"}`}>
                          {item.isDraft ? "draft" : item.state}
                        </span>
                      </div>
                    ))}
                    {highlightedIssues.map((item) => (
                      <div className="compact-row" key={`issue-${item.number}`}>
                        <div className="compact-copy">
                          <strong>{`Issue #${item.number} · ${item.title}`}</strong>
                          <span>{`${item.author} · ${item.updatedAt}`}</span>
                        </div>
                        <span className="state-pill is-waiting">{item.state}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="section-block compact-section-block">
                <div className="section-label">Changes</div>
                {repository.changes.length === 0 ? (
                  <div className="settings-empty-state">Working tree is clean.</div>
                ) : (
                  <div className="compact-list compact-list-tight">
                    {repository.changes.map((change) => (
                      <button
                        className={`compact-change-row ${change.path === activeFilePath ? "is-active" : ""}`}
                        key={`${change.statusCode}-${change.path}`}
                        onClick={() => void handleSelectFile(change.path)}
                        type="button"
                      >
                        <span className="compact-change-status">{change.statusCode.trim() || "M"}</span>
                        <div className="compact-copy">
                          <strong>{labelForFilePath(change.path)}</strong>
                          <span>{change.summary}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        );
      case "agents":
        return (
          <>
            <div className="pane-header">
              <span>Agents</span>
              <span className="pane-meta">{snapshot.agents.length} registered</span>
            </div>

            <div className="pane-scroll">
              <section className="section-block">
                <div className="compact-list">
                  {snapshot.agents.map((agent) => (
                    <div className="compact-row" key={agent.id}>
                      <div className="compact-copy">
                        <strong>{agent.label}</strong>
                        <span>{agent.role}</span>
                      </div>
                      <span className={`state-pill ${agentTone(agent.status)}`}>{agent.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        );
      case "workflows":
        return (
          <>
            <div className="pane-header">
              <span>Workflows</span>
              <span className="pane-meta">
                {workflowProgress ? `${workflowProgress.completed}/${workflowProgress.total}` : "Idle"}
              </span>
            </div>

            <div className="pane-scroll">
              <section className="section-block">
                <div className="summary-card">
                  <strong>{workflowRun?.status ?? "ready"}</strong>
                  <p>
                    {workflowRun
                      ? `${workflowProgress?.completed ?? 0} of ${workflowProgress?.total ?? 0} steps have finished.`
                      : "The recommended workflow has not started yet."}
                  </p>
                </div>
              </section>

              <section className="section-block">
                <div className="compact-list">
                  {(workflowRun?.items ?? workflowTemplate.items).map((item) => (
                    <div className="compact-row" key={item.id}>
                      <div className="compact-copy">
                        <strong>{item.label}</strong>
                        <span>{item.command}</span>
                      </div>
                      <span className={`state-pill ${taskTone(item.status)}`}>{item.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        );
      case "artifacts":
        return (
          <>
            <div className="pane-header">
              <span>Artifacts</span>
              <span className="pane-meta">{recentArtifacts.length} recent</span>
            </div>

            <div className="pane-scroll">
              <section className="section-block">
                <div className="compact-list">
                  {recentArtifacts.map((artifact) => (
                    <div className="artifact-row" key={artifact.id}>
                      <div className="compact-copy">
                        <strong>{artifact.title}</strong>
                        <span>{artifact.contentSummary}</span>
                      </div>
                      <span className="signal-pill">{artifact.kind}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        );
      case "search":
        return (
          <>
            <div className="pane-header">
              <span>Search</span>
              <span className="pane-meta">{filteredWorkspaceFiles.length} matches</span>
            </div>

            <div className="pane-scroll">
              <section className="section-block">
                <div className="explorer-search">
                  <input
                    className="explorer-search-input"
                    onChange={(event) => setExplorerQuery(event.target.value)}
                    placeholder="Search workspace files"
                    value={explorerQuery}
                  />
                </div>
                <div className="flat-list">
                  {filteredWorkspaceFiles.map((path) => (
                    <button
                      className={`flat-list-row ${path === activeFilePath ? "is-active" : ""}`}
                      key={path}
                      onClick={() => void handleSelectFile(path)}
                      type="button"
                    >
                      <span>{path}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </>
        );
    }
  };

  const handleSelectFile = async (relativePath: string) => {
    if (!relativePath || relativePath === activeFilePath) {
      return;
    }

    if (getWorkspaceDocument(openDocuments, relativePath)) {
      setActiveFilePath(relativePath);
      setWorkspaceNotice(`Switched to ${relativePath}`);
      return;
    }

    await loadActiveFile(relativePath);
  };

  const handleSaveFile = async () => {
    if (!activeFilePath) {
      return;
    }

    setSaveBusy(true);

    try {
      const content = activeDocument?.currentContent ?? "";
      const saved = isExternalDocumentPath(activeFilePath)
        ? await writeExternalFile(activeFilePath, content)
        : await writeWorkspaceFile(activeFilePath, content);
      startTransition(() => {
        setOpenDocuments((current) => markWorkspaceDocumentSaved(current, saved.path, saved.content));
        setWorkspaceNotice(`Saved ${saved.path}`);
      });
    } finally {
      setSaveBusy(false);
    }
  };

  const handleReloadFile = async () => {
    if (!activeFilePath) {
      return;
    }

    setWorkspaceBusy(true);

    try {
      const file = isExternalDocumentPath(activeFilePath)
        ? await readExternalFile(activeFilePath)
        : await readWorkspaceFile(activeFilePath);
      startTransition(() => {
        setOpenDocuments((current) =>
          upsertWorkspaceDocument(current, createWorkspaceDocument(file.path, file.content))
        );
        setWorkspaceNotice(`Reloaded ${file.path}`);
      });
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const launchCommand = async (command: string, workflowItemId?: string) => {
    const trimmed = command.trim();
    if (!trimmed) {
      return false;
    }

    setBottomView("terminal");
    setBottomOpen(true);
    setWorkspaceNotice(`Running ${trimmed}`);

    try {
      const started = await startWorkspaceCommand(trimmed);
      startTransition(() => {
        setActiveTerminalRunId(started.runId);
        setSelectedTerminalRunId(started.runId);
        setTerminalSessions((current) => appendTerminalSession(current, createTerminalSession(started)));
        if (workflowItemId) {
          setWorkflowRun((current) => (current ? markWorkflowItemRunning(current, workflowItemId, started.runId) : current));
        }
      });

      return true;
    } catch {
      const result = await runWorkspaceCommand(trimmed);
      const fallbackSession = createTerminalSessionFromResult(result);

      startTransition(() => {
        setSelectedTerminalRunId(fallbackSession.runId);
        setTerminalSessions((current) => appendTerminalSession(current, fallbackSession));
        setWorkspaceNotice(result.success ? `Command finished: ${trimmed}` : `Command failed: ${trimmed}`);
        if (workflowItemId) {
          setWorkflowRun((current) => (current ? applyWorkflowCommandResult(current, workflowItemId, result) : current));
        }
      });

      return result.success;
    }
  };

  const handleRunCommand = async (command: string) => {
    await launchCommand(command);
  };

  const handleCancelActiveCommand = async () => {
    if (!activeTerminalRunId) {
      return;
    }

    try {
      if (workflowRun?.status === "running") {
        setWorkflowRun((current) => (current ? cancelWorkflowRun(current) : current));
      }
      await cancelWorkspaceCommand(activeTerminalRunId);
      setWorkspaceNotice(`Cancelling ${activeTerminalSession?.command ?? activeTerminalRunId}`);
    } catch {
      setWorkspaceNotice("Cancel request failed.");
    }
  };

  const runPreset = async (preset: WorkspaceCommandPreset) => {
    setTerminalInput(preset.command);
    await handleRunCommand(preset.command);
  };

  const handleStartWorkflow = () => {
    if (terminalBusy || workflowDispatchBusy) {
      return;
    }

    setBottomView("build");
    setBottomOpen(true);
    setWorkflowRun(createWorkflowRun(snapshot.executionPlan));
    setWorkspaceNotice("Queued the recommended workflow.");
  };

  const handleResetWorkflow = () => {
    if (terminalBusy) {
      return;
    }

    setWorkflowRun(createWorkflowRun(snapshot.executionPlan));
    setWorkspaceNotice("Workflow state reset.");
  };

  const handleDiscoverOpenRouterModels = async () => {
    const openRouterAccount = selectedProfile?.provider === "openrouter"
      ? selectedAccount ?? getPrimaryProviderAccount(settings, "openrouter")
      : getPrimaryProviderAccount(settings, "openrouter");

    if (!openRouterAccount) {
      setProviderCatalogError("Add an OpenRouter account before refreshing the catalog.");
      return;
    }

    setProviderCatalogBusy("openrouter");
    setProviderCatalogError(null);

    try {
      const catalog = await fetchOpenRouterCatalog(openRouterAccount.apiKey, openRouterAccount.baseUrl);
      startTransition(() => {
        setOpenRouterCatalog(catalog);
        setWorkspaceNotice(`Loaded ${catalog.models.length} OpenRouter models (${catalog.freeCount} free).`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenRouter catalog request failed.";
      startTransition(() => {
        setProviderCatalogError(message);
        setWorkspaceNotice(message);
      });
    } finally {
      setProviderCatalogBusy(null);
    }
  };

  const handleRefreshRepository = async () => {
    setRepositoryBusy(true);

    try {
      const nextRepository = await loadRepositorySnapshot();
      startTransition(() => {
        setRepository(parseRepositorySnapshot(nextRepository));
        setWorkspaceNotice(
          nextRepository.available
            ? `Loaded ${nextRepository.statusLines.filter((line) => !line.startsWith("##")).length} local git changes.`
            : "Git metadata is not available for this workspace."
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Repository refresh failed.";
      startTransition(() => setWorkspaceNotice(message));
    } finally {
      setRepositoryBusy(false);
    }
  };

  const handleRefreshGitHub = async () => {
    if (!githubRemote) {
      setGithubError("No GitHub remote is configured for this workspace.");
      return;
    }

    setGithubBusy(true);
    setGithubError(null);

    try {
      const nextSignals = await fetchGitHubRepositorySignals(githubRemote, integrations.githubToken);
      startTransition(() => {
        setGithubSignals(nextSignals);
        setWorkspaceNotice(`Loaded ${nextSignals.pulls.length} pull requests and ${nextSignals.issues.length} issues.`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub refresh failed.";
      startTransition(() => {
        setGithubSignals(null);
        setGithubError(message);
        setWorkspaceNotice(message);
      });
    } finally {
      setGithubBusy(false);
    }
  };

  const handleCopyCommitSuggestion = async () => {
    try {
      await navigator.clipboard.writeText(repository.commitSuggestion);
      setWorkspaceNotice("Copied the commit suggestion to the clipboard.");
    } catch {
      setWorkspaceNotice(repository.commitSuggestion);
    }
  };

  const updateSelectedProvider = (
    patch: Partial<Omit<ProviderProfile, "provider" | "label">>
  ) => {
    if (!selectedProfile) {
      return;
    }

    setSettings((current) => updateProviderProfile(current, selectedProfile.provider, patch, snapshot.models));
  };

  const updateSelectedAccount = (
    patch: Partial<Omit<ProviderAccount, "id" | "provider">>
  ) => {
    if (!selectedAccount) {
      return;
    }

    setSettings((current) => updateProviderAccount(current, selectedAccount.id, patch, snapshot.models));
  };

  const handleAddProviderAccount = () => {
    if (!selectedProfile) {
      return;
    }

    setSettings((current) => addProviderAccount(current, selectedProfile.provider));
    setWorkspaceNotice(`Added another ${selectedProfile.label} account.`);
  };

  const handleRemoveSelectedAccount = () => {
    if (!selectedProfile || !selectedAccount || selectedProviderAccounts.length <= 1) {
      return;
    }

    setSettings((current) => removeProviderAccount(current, selectedAccount.id, snapshot.models));
    setWorkspaceNotice(`Removed ${selectedAccount.label}.`);
  };

  const handleSetPrimaryAccount = () => {
    if (!selectedProfile || !selectedAccount) {
      return;
    }

    setSettings((current) =>
      setPrimaryProviderAccount(current, selectedProfile.provider, selectedAccount.id, snapshot.models)
    );
    setWorkspaceNotice(`${selectedAccount.label} is now the primary ${selectedProfile.label} account.`);
  };

  const updateQuickConnectProfile = (
    patch: Partial<Omit<ProviderProfile, "provider" | "label">>
  ) => {
    if (!quickSetupProfile) {
      return;
    }

    setSettings((current) => updateProviderProfile(current, quickSetupProfile.provider, patch, snapshot.models));
  };

  const updateQuickConnectAccount = (
    patch: Partial<Omit<ProviderAccount, "id" | "provider">>
  ) => {
    if (!quickSetupAccount) {
      return;
    }

    setSettings((current) => updateProviderAccount(current, quickSetupAccount.id, patch, snapshot.models));
  };

  const handleQuickConnectModelChange = (modelId: string) => {
    if (!quickSetupProfile) {
      return;
    }

    setSettings((current) => {
      const next = updateProviderProfile(
        current,
        quickSetupProfile.provider,
        {
          enabled: true,
          preferredModelId: modelId
        },
        snapshot.models
      );
      return setActiveModel(next, modelId, snapshot.models);
    });
  };

  const handleQuickConnectProvider = (provider: ModelProvider) => {
    setSelectedProvider(provider);
    setSettingsView("providers");
  };

  const handleQuickConnectReady = () => {
    if (!quickSetupProfile || !quickSetupAccount) {
      return;
    }

    setSettings((current) => {
      let next = updateProviderProfile(
        current,
        quickSetupProfile.provider,
        {
          enabled: true
        },
        snapshot.models
      );
      next = updateProviderAccount(
        next,
        quickSetupAccount.id,
        {
          enabled: true
        },
        snapshot.models
      );

      if (quickSetupProfile.preferredModelId.trim()) {
        next = setActiveModel(next, quickSetupProfile.preferredModelId, snapshot.models);
      }

      return next;
    });

    setWorkspaceNotice(`${quickSetupProfile.label} is ready and saved locally for this workspace.`);
  };

  const handleUseRecommendedProvider = () => {
    const recommendedEntry = providerRadar.recommended ?? providerRadar.active;
    if (!recommendedEntry) {
      return;
    }

    setSelectedProvider(recommendedEntry.provider);
    setSelectedAccountId(recommendedEntry.primaryAccountId);
    setSettings((current) => {
      let next = current;

      if (recommendedEntry.primaryAccountId) {
        next = setPrimaryProviderAccount(next, recommendedEntry.provider, recommendedEntry.primaryAccountId, snapshot.models);
      }

      if (recommendedEntry.preferredModelId.trim()) {
        next = setActiveModel(next, recommendedEntry.preferredModelId, snapshot.models);
      }

      return next;
    });
    setWorkspaceNotice(`Focused ${recommendedEntry.label} as the best ready route for this workspace.`);
  };

  const handleClearChatHistory = () => {
    const nextSession = createDefaultChatSession();
    setChatMode(nextSession.mode);
    setChatMessages(nextSession.messages);
    setAgentActionStatuses({});
    setWorkspaceNotice("Cleared chat history for this workspace.");
  };

  const handleAddPermissionRule = () => {
    const trimmedPattern = permissionRulePatternDraft.trim();
    if (!trimmedPattern) {
      setWorkspaceNotice("Enter a command or workflow pattern before adding a rule.");
      return;
    }

    setPermissionSettings((current) =>
      appendPermissionRule(current, permissionRuleSubjectDraft, trimmedPattern, permissionRuleActionDraft)
    );
    setPermissionRulePatternDraft("");
    setWorkspaceNotice(
      `Added a ${getPermissionDecisionLabel(permissionRuleActionDraft)} ${getPermissionRuleSubjectLabel(permissionRuleSubjectDraft).toLowerCase()} rule for ${trimmedPattern}.`
    );
  };

  const handleRemovePermissionRule = (ruleId: string) => {
    setPermissionSettings((current) => removePermissionRule(current, ruleId));
    setWorkspaceNotice("Removed the custom approval rule for this workspace.");
  };

  const handleTrustAgentAction = async (action: AgentSuggestedAction) => {
    setPermissionSettings((current) => rememberAgentActionApproval(current, action));
    setWorkspaceNotice(`${action.label} is now trusted for this workspace.`);
    await handleApplyAgentAction(action, {
      bypassPermission: true,
      source: "manual"
    });
  };

  const handleApplyAgentAction = async (
    action: AgentSuggestedAction,
    options?: {
      bypassPermission?: boolean;
      source?: "manual" | "auto";
    }
  ): Promise<boolean> => {
    const permissionDecision = evaluateAgentActionPermission(action, permissionSettings);
    if (!options?.bypassPermission && permissionDecision === "deny") {
      setAgentActionStatuses((current) => ({
        ...current,
        [action.id]: "blocked"
      }));
      setWorkspaceNotice(
        `${action.label} is blocked by the ${getPermissionProfileLabel(permissionSettings.profile)} approval profile.`
      );
      return false;
    }

    setAgentActionStatuses((current) => ({
      ...current,
      [action.id]: "running"
    }));

    try {
      switch (action.type) {
        case "open_file":
          if (!action.path) {
            throw new Error("Open file action is missing a path.");
          }
          await handleSelectFile(action.path);
          break;
        case "run_command":
          if (!action.command) {
            throw new Error("Run command action is missing a command.");
          }
          setTerminalInput(action.command);
          await launchCommand(action.command);
          break;
        case "run_workflow":
          if (action.workflow !== "recommended") {
            throw new Error("Unsupported workflow action.");
          }
          handleStartWorkflow();
          break;
      }

      setAgentActionStatuses((current) => ({
        ...current,
        [action.id]: "completed"
      }));
      setWorkspaceNotice(options?.source === "auto" ? `Auto-ran ${action.label}.` : action.label);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to apply ${action.label}.`;
      setAgentActionStatuses((current) => ({
        ...current,
        [action.id]: "failed"
      }));
      setWorkspaceNotice(message);
      return false;
    }
  };

  const autoApplyAgentActionPlan = async (actionPlan?: AgentActionPlan) => {
    if (!actionPlan || chatMode !== "agent" || settings.parallelAgentMode) {
      return;
    }

    let autoApplied = 0;
    let waitingForReview = 0;
    let blocked = 0;
    let activeActionStarted = false;

    for (const action of actionPlan.actions) {
      const permissionDecision = evaluateAgentActionPermission(action, permissionSettings);

      if (permissionDecision === "deny") {
        blocked += 1;
        setAgentActionStatuses((current) => ({
          ...current,
          [action.id]: "blocked"
        }));
        continue;
      }

      if (permissionDecision === "ask" || activeActionStarted) {
        waitingForReview += 1;
        continue;
      }

      const applied = await handleApplyAgentAction(action, {
        bypassPermission: true,
        source: "auto"
      });

      if (applied) {
        autoApplied += 1;
        if (action.type !== "open_file") {
          activeActionStarted = true;
        }
      }
    }

    const summary: string[] = [];
    if (autoApplied > 0) {
      summary.push(`${autoApplied} safe action${autoApplied === 1 ? "" : "s"} auto-ran`);
    }
    if (waitingForReview > 0) {
      summary.push(`${waitingForReview} action${waitingForReview === 1 ? "" : "s"} waiting for review`);
    }
    if (blocked > 0) {
      summary.push(`${blocked} blocked by the ${getPermissionProfileLabel(permissionSettings.profile)} profile`);
    }

    if (summary.length > 0) {
      setWorkspaceNotice(summary.join(". ") + ".");
    }
  };

  const handleLaunchSkill = async () => {
    if (!selectedSkill) {
      return;
    }

    try {
      await launchSkillProcess({
        executablePath: selectedSkill.executablePath,
        arguments: parseSkillArguments(selectedSkill),
        workingDirectory: selectedSkill.workingDirectory || undefined
      });
      setWorkspaceNotice(`Launched ${selectedSkill.label}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to launch ${selectedSkill.label}.`;
      setWorkspaceNotice(message);
    }
  };

  const handleSendChat = async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatBusy) {
      return;
    }

    const userMessage = createChatMessage("user", prompt);
    setChatBusy(true);
    setChatInput("");
    setChatMessages((current) => [...current, userMessage]);

    if (!chatProfile) {
      setChatBusy(false);
      setChatMessages((current) => [
        ...current,
        createChatMessage("assistant", "Connect a provider before sending chat requests.")
      ]);
      return;
    }

    if (!chatModelId.trim()) {
      setChatBusy(false);
      setChatMessages((current) => [
        ...current,
        createChatMessage("assistant", `${chatProviderLabel} does not have a preferred model configured yet.`)
      ]);
      return;
    }

    if (chatAccounts.length === 0) {
      setChatBusy(false);
      setChatMessages((current) => [
        ...current,
        createChatMessage(
          "assistant",
          `${chatProviderLabel} is not ready. Add at least one enabled account with a valid API key and base URL.`
        )
      ]);
      return;
    }

    try {
      const baseMessages = buildProviderChatMessages(
        chatMode,
        snapshot,
        activeFilePath,
        activeDocument?.currentContent ?? "",
        chatMessages,
        prompt
      );
      const parallelTargets =
        chatMode === "agent" && settings.parallelAgentMode
          ? buildParallelAgentTargets({
              activeModelId: settings.activeModelId,
              maxCount: settings.concurrentAgentCount,
              models: snapshot.models,
              preferredModelId: chatModelId,
              preferredProvider: chatProfile.provider,
              settings
            })
          : [];

      if (parallelTargets.length > 1) {
        const settled = await Promise.allSettled(
          parallelTargets.map((target) =>
            sendCompatibleChatCompletion({
              accounts: [target.account],
              messages: decorateMessagesForParallelTarget(baseMessages, target, parallelTargets.length),
              mode: chatMode,
              modelId: target.modelId,
              provider: target.provider,
              sessionId: snapshot.sessionId
            })
          )
        );

        const nextMessages: ChatMessage[] = [];
        const failures: string[] = [];

        settled.forEach((result, index) => {
          const target = parallelTargets[index]!;
          if (result.status === "fulfilled") {
            const parsedResponse = extractAgentActionPlan(result.value.content);
            const actionPlan = chatMode === "agent" ? parsedResponse.actionPlan : undefined;
            nextMessages.push(
              createChatMessage("assistant", parsedResponse.cleanContent || result.value.content, {
                accountLabel: `${target.roleLabel} · ${result.value.accountLabel}`,
                actionPlan,
                agentRole: target.roleLabel,
                modelId: result.value.modelId
              })
            );
            return;
          }

          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          failures.push(`${target.roleLabel}: ${message}`);
        });

        if (failures.length > 0) {
          nextMessages.push(
            createChatMessage(
              "assistant",
              failures.length === parallelTargets.length
                ? `Every parallel agent lane failed.\n\n${failures.join("\n")}`
                : `Some agent lanes failed.\n\n${failures.join("\n")}`,
              {
                accountLabel: "OpenGravity runtime",
                agentRole: "Runtime"
              }
            )
          );
        }

        startTransition(() => {
          setChatMessages((current) => [...current, ...nextMessages]);
          setWorkspaceNotice(
            nextMessages.length > 0
              ? `Parallel agent mode finished ${parallelTargets.length} lanes.`
              : "Parallel agent mode failed across all lanes."
          );
        });
      } else {
        const response = await sendCompatibleChatCompletion({
          accounts: chatAccounts,
          messages: baseMessages,
          mode: chatMode,
          modelId: chatModelId,
          provider: chatProfile.provider,
          sessionId: snapshot.sessionId
        });
        const parsedResponse = extractAgentActionPlan(response.content);
        const actionPlan = chatMode === "agent" ? parsedResponse.actionPlan : undefined;

        startTransition(() => {
          setChatMessages((current) => [
            ...current,
            createChatMessage("assistant", parsedResponse.cleanContent || response.content, {
              accountLabel: response.accountLabel,
              actionPlan,
              modelId: response.modelId
            })
          ]);
          setWorkspaceNotice(`Chat response received from ${response.accountLabel}.`);
        });

        if (actionPlan) {
          void autoApplyAgentActionPlan(actionPlan);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat request failed.";
      startTransition(() => {
        setChatMessages((current) => [...current, createChatMessage("assistant", message)]);
        setWorkspaceNotice(message);
      });
    } finally {
      setChatBusy(false);
    }
  };

  const renderSideView = () => {
    switch (sideView) {
      case "overview":
        return (
          <div className="side-stack">
            <div className="insight-card">
              <span className="insight-label">Current goal</span>
              <strong>{snapshot.handoffPlan.continuityPack.currentGoal}</strong>
            </div>
            <div className="insight-card">
              <span className="insight-label">Active model</span>
              <strong>{activeModelLabel}</strong>
            </div>
            <div className="insight-card">
              <span className="insight-label">Workspace status</span>
              <strong>{workspaceNotice}</strong>
            </div>
            <div className="summary-card">
              <strong>Pending actions</strong>
              {snapshot.handoffPlan.continuityPack.pendingActions.map((action) => (
                <div className="summary-line" key={action}>
                  <span>{action}</span>
                </div>
              ))}
            </div>
          </div>
        );
      case "handoff":
        return (
          <div className="side-stack">
            <div className="summary-card">
              <strong>{snapshot.handoffPlan.continuityPack.title}</strong>
              <p>{snapshot.handoffPlan.continuityPack.executiveSummary}</p>
              <div className="summary-line">
                <span>Fallback trail</span>
                <strong>{snapshot.handoffPlan.continuityPack.fallbackTrail.join(" -> ")}</strong>
              </div>
              <div className="summary-line">
                <span>Open blockers</span>
                <strong>{snapshot.handoffPlan.continuityPack.openBlockers.join(", ")}</strong>
              </div>
            </div>
            <div className="compact-list">
              {snapshot.providerHealth.map((provider) => (
                <div className="compact-row" key={provider.provider}>
                  <div className="compact-copy">
                    <strong>{provider.provider}</strong>
                    <span>{provider.reason ?? "No provider note."}</span>
                  </div>
                  <span className={`state-pill ${providerTone(provider.state)}`}>{provider.state}</span>
                </div>
              ))}
            </div>
          </div>
        );
      case "artifacts":
        return (
          <div className="compact-list">
            {recentArtifacts.map((artifact) => (
              <div className="artifact-row" key={artifact.id}>
                <div className="compact-copy">
                  <strong>{artifact.title}</strong>
                  <span>{artifact.contentSummary}</span>
                </div>
                <span className="signal-pill">{artifact.kind}</span>
              </div>
            ))}
          </div>
        );
      case "runtime":
        return (
          <div className="compact-list">
            {snapshot.agents.map((agent) => (
              <div className="compact-row" key={agent.id}>
                <div className="compact-copy">
                  <strong>{agent.label}</strong>
                  <span>{agent.role}</span>
                </div>
                <span className={`state-pill ${agentTone(agent.status)}`}>{agent.status}</span>
              </div>
            ))}
          </div>
        );
    }
  };

  const renderMenuDropdown = () => {
    if (!openMenuId) {
      return null;
    }

    interface MenuEntry {
      label: string;
      shortcut?: string;
      checked?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }

    const runAction = (action: () => void) => {
      action();
      setOpenMenuId(null);
    };

    const menuEntries: MenuEntry[] = (() => {
      switch (openMenuId) {
        case "file":
          return [
            {
              label: saveBusy ? "Save current file..." : "Save current file",
              shortcut: "Ctrl+S",
              disabled: !activeFilePath,
              onSelect: () => void handleSaveFile()
            },
            {
              label: "Reload current file",
              disabled: !activeFilePath,
              onSelect: () => void handleReloadFile()
            },
            {
              label: "Provider settings",
              shortcut: "Ctrl+,",
              onSelect: () => setSettingsOpen(true)
            }
          ];
        case "edit":
          return [
            {
              label: "Focus editor",
              onSelect: () => setWorkspaceNotice(`Focused ${labelForFilePath(activeFilePath || "editor")}.`)
            },
            {
              label: "Open active file in explorer",
              disabled: !activeFilePath,
              onSelect: () => {
                setPrimaryView("explorer");
                setExplorerOpen(true);
                setWorkspaceNotice(`Revealed ${labelForFilePath(activeFilePath)} in Explorer.`);
              }
            }
          ];
        case "selection":
          return [
            {
              label: "Focus explorer",
              onSelect: () => {
                setPrimaryView("explorer");
                setExplorerOpen(true);
                setWorkspaceNotice("Explorer is visible.");
              }
            },
            {
              label: "Focus source control",
              onSelect: () => {
                setPrimaryView("source-control");
                setExplorerOpen(true);
                setWorkspaceNotice("Source Control is visible.");
              }
            },
            {
              label: "Focus terminal",
              onSelect: () => {
                setBottomView("terminal");
                setBottomOpen(true);
              }
            },
            {
              label: "Focus agent",
              onSelect: () => setDockOpen(true)
            }
          ];
        case "view":
          return [
            {
              label: "Activity bar",
              checked: activityBarOpen,
              onSelect: () => setActivityBarOpen((value) => !value)
            },
            {
              label: "Primary side bar",
              checked: explorerOpen,
              onSelect: () => setExplorerOpen((value) => !value)
            },
            {
              label: "Secondary side bar",
              checked: dockOpen,
              onSelect: () => setDockOpen((value) => !value)
            },
            {
              label: "Panel",
              checked: bottomOpen,
              onSelect: () => setBottomOpen((value) => !value)
            },
            {
              label: "Status bar",
              checked: statusBarOpen,
              onSelect: () => setStatusBarOpen((value) => !value)
            },
            {
              label: "Customize layout...",
              onSelect: () => setLayoutOpen(true)
            }
          ];
        case "go":
          return [
            {
              label: "Source Control",
              onSelect: () => {
                setPrimaryView("source-control");
                setExplorerOpen(true);
              }
            },
            {
              label: "Explorer",
              onSelect: () => {
                setPrimaryView("explorer");
                setExplorerOpen(true);
              }
            },
            {
              label: "README",
              onSelect: () => void handleSelectFile("README.md")
            },
            {
              label: "Desktop shell",
              onSelect: () => void handleSelectFile("apps/desktop-shell/src/App.tsx")
            },
            {
              label: "Rust bridge",
              onSelect: () => void handleSelectFile("apps/desktop-shell/src-tauri/src/main.rs")
            }
          ];
        case "run":
          return [
            {
              label: "Run suggested plan",
              disabled: snapshot.setupRequired || terminalBusy || workflowDispatchBusy,
              onSelect: () => handleStartWorkflow()
            },
            {
              label: "Reset workflow",
              disabled: terminalBusy,
              onSelect: () => handleResetWorkflow()
            },
            {
              label: commandPresets[0]?.label ?? "Run workspace command",
              disabled: !commandPresets[0] || terminalBusy,
              onSelect: () => {
                const preset = commandPresets[0];
                if (preset) {
                  void runPreset(preset);
                }
              }
            }
          ];
        case "terminal":
          return [
            {
              label: "Open terminal",
              onSelect: () => {
                setBottomView("terminal");
                setBottomOpen(true);
              }
            },
            {
              label: "Reuse selected command",
              disabled: !selectedTerminalSession,
              onSelect: () => {
                if (selectedTerminalSession) {
                  setTerminalInput(selectedTerminalSession.command);
                }
              }
            },
            {
              label: "Cancel active command",
              disabled: !activeTerminalRunId,
              onSelect: () => void handleCancelActiveCommand()
            }
          ];
        case "help":
          return [
            {
              label: "Architecture notes",
              onSelect: () => void handleSelectFile("docs/opengravity-v1-architecture.md")
            },
            {
              label: "Master plan",
              onSelect: () => void handleSelectFile("docs/master-plan.md")
            },
            {
              label: "Provider settings",
              onSelect: () => setSettingsOpen(true)
            }
          ];
      }
    })();

    return (
      <div className="menu-dropdown" role="menu">
        {menuEntries.map((entry) => (
          <button
            className={`menu-dropdown-item ${entry.checked ? "is-checked" : ""}`}
            disabled={entry.disabled}
            key={entry.label}
            onClick={() => runAction(entry.onSelect)}
            type="button"
          >
            <span>{entry.label}</span>
            {entry.shortcut ? <span className="menu-shortcut">{entry.shortcut}</span> : null}
          </button>
        ))}
      </div>
    );
  };

  const renderBottomContent = () => {
    switch (bottomView) {
      case "build":
        return (
          <>
            <div className="bottom-panel-header">
              <span className="section-label">Execution plan</span>
              <div className="build-toolbar">
                <span className="dock-chip">{snapshot.executionPlan.primaryBuildSystem ?? "inspect"}</span>
                <button
                  className="secondary-button slim-button"
                  disabled={terminalBusy || workflowDispatchBusy}
                  onClick={() => handleResetWorkflow()}
                  type="button"
                >
                  Reset
                </button>
                <button
                  className="primary-button slim-button"
                  disabled={terminalBusy || workflowDispatchBusy || snapshot.setupRequired}
                  onClick={() => handleStartWorkflow()}
                  type="button"
                >
                  Run plan
                </button>
              </div>
            </div>
            <div className="drawer-content">
              <div className="workflow-summary-card">
                <div className="workflow-summary-head">
                  <strong>Recommended workflow</strong>
                  <span
                    className={`state-pill ${
                      workflowRun?.status === "completed"
                        ? "is-done"
                        : workflowRun?.status === "failed"
                          ? "is-failed"
                          : workflowRun?.status === "cancelled"
                            ? "is-blocked"
                            : "is-running"
                    }`}
                  >
                    {workflowRun?.status ?? "running"}
                  </span>
                </div>
                <div className="workflow-summary-copy">
                  {workflowProgress
                    ? `${workflowProgress.completed}/${workflowProgress.total} commands completed`
                    : "No workflow state"}
                </div>
                {snapshot.setupRequired ? (
                  <div className="workflow-warning">
                    Connect a provider first so the recommended repair workflow can continue with the same session.
                  </div>
                ) : null}
              </div>

              <div className="compact-list">
                {(workflowRun?.items ?? []).map((item) => (
                  <div className="workflow-row" key={item.id}>
                    <div className="compact-copy">
                      <strong>{item.label}</strong>
                      <span>{item.command}</span>
                    </div>
                    <div className="workflow-row-right">
                      <span className="signal-pill">{item.kind}</span>
                      <span
                        className={`state-pill ${
                          item.status === "completed"
                            ? "is-done"
                            : item.status === "running"
                              ? "is-running"
                              : item.status === "cancelled"
                                ? "is-blocked"
                                : item.status === "failed"
                                  ? "is-failed"
                                  : "is-waiting"
                        }`}
                      >
                        {item.status}
                      </span>
                      <button
                        className="secondary-button slim-button"
                        disabled={terminalBusy || workflowDispatchBusy}
                        onClick={() => void handleRunCommand(item.command)}
                        type="button"
                      >
                        Queue
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      case "tasks":
        return (
          <>
            <div className="bottom-panel-header">
              <span className="section-label">Task graph</span>
              <span className="dock-chip">{snapshot.runtimeStats.running} active</span>
            </div>
            <div className="drawer-content">
              <div className="compact-list">
                {snapshot.tasks.map((task) => (
                  <div className="compact-row" key={task.id}>
                    <div className="compact-copy">
                      <strong>{task.title}</strong>
                      <span>
                        {task.requiredRole} / {task.taskType}
                      </span>
                    </div>
                    <span className={`state-pill ${taskTone(task.status)}`}>{task.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      case "events":
        return (
          <>
            <div className="bottom-panel-header">
              <span className="section-label">Recent events</span>
              <span className="dock-chip">{snapshot.sessionRecord.events.length}</span>
            </div>
            <div className="drawer-content">
              <div className="compact-list">
                {recentEvents.map((event) => (
                  <div className="event-row" key={event.id}>
                    <div className="compact-copy">
                      <strong>{event.type}</strong>
                      <span>{event.message}</span>
                    </div>
                    <span className="event-time">
                      {new Date(event.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      case "log":
        return (
          <>
            <div className="bottom-panel-header">
              <span className="section-label">Build failure</span>
              <span className={`state-pill ${taskTone("blocked")}`}>{snapshot.failure.category}</span>
            </div>
            <div className="drawer-content">
              <div className="hint-stack">
                {snapshot.failure.suggestedFixHints.map((hint) => (
                  <div className="hint-row" key={hint}>
                    <span className="list-marker" />
                    <span>{hint}</span>
                  </div>
                ))}
              </div>
              <pre className="log-view">{snapshot.buildLog}</pre>
            </div>
          </>
        );
      case "terminal":
        return (
          <>
            <div className="bottom-panel-header">
              <span className="section-label">Terminal</span>
              <span className="dock-chip">{terminalBusy ? "running" : selectedTerminalSession ? "ready" : "idle"}</span>
            </div>
            <div className="drawer-content terminal-drawer-content">
              <div className="terminal-toolbar">
                <div className="terminal-runner">
                  <input
                    className="terminal-input"
                    onChange={(event) => setTerminalInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (!terminalBusy) {
                          void handleRunCommand(terminalInput);
                        }
                      }
                    }}
                    placeholder="Run an allowed workspace command"
                    value={terminalInput}
                  />
                  {terminalBusy ? (
                    <button className="secondary-button" onClick={() => void handleCancelActiveCommand()} type="button">
                      Cancel
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      disabled={terminalInput.trim().length === 0}
                      onClick={() => void handleRunCommand(terminalInput)}
                      type="button"
                    >
                      Run
                    </button>
                  )}
                </div>
              </div>

              {selectedTerminalSession ? (
                <div className="terminal-session-header terminal-session-header-compact">
                  <div className="terminal-session-copy">
                    <strong>{selectedTerminalSession.command}</strong>
                    <span>{selectedTerminalSession.message ?? formatCommandSummary(selectedTerminalSession)}</span>
                  </div>
                  <div className="terminal-session-actions">
                    <span
                      className={`state-pill ${
                        selectedTerminalSession.status === "running"
                          ? "is-running"
                          : selectedTerminalSession.status === "completed"
                            ? "is-done"
                            : selectedTerminalSession.status === "cancelled"
                              ? "is-blocked"
                              : "is-failed"
                      }`}
                    >
                      {formatCommandSummary(selectedTerminalSession)}
                    </span>
                    <button
                      className="secondary-button slim-button"
                      onClick={() => setTerminalInput(selectedTerminalSession.command)}
                      type="button"
                    >
                      Reuse
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="terminal-panel-simple">
                <TerminalSurface
                  emptyLabel="Run a workspace command to see native output here."
                  session={selectedTerminalSession}
                />
              </div>

              {terminalSessions.length > 1 ? (
                <div className="terminal-history-strip">
                  {terminalSessions.slice(0, 6).map((session) => (
                    <button
                      className={`terminal-history-chip ${session.runId === selectedTerminalSession?.runId ? "is-active" : ""}`}
                      key={session.runId}
                      onClick={() => setSelectedTerminalRunId(session.runId)}
                      type="button"
                    >
                      {session.command}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        );
    }
  };

  return (
    <div className="window-shell">
      <header className="window-chrome">
        <div className="window-title">OpenGravity</div>
        <div className="window-workspace-label">{workspaceDisplayName}</div>
      </header>

      <div className="menu-strip">
        <nav className="menu-items">
          {menuItems.map((item) => (
            <div className="menu-item-shell" key={item.id}>
              <button
                className={`menu-item ${openMenuId === item.id ? "is-active" : ""}`}
                onClick={() => setOpenMenuId((current) => (current === item.id ? null : item.id))}
                type="button"
              >
                {item.label}
              </button>
              {openMenuId === item.id ? renderMenuDropdown() : null}
            </div>
          ))}
        </nav>

        <div className="session-path">{activeFilePath ? labelForFilePath(activeFilePath) : workspaceDisplayName}</div>

        <div className="session-pills">
          <button
            className={`chrome-toggle ${explorerOpen ? "is-on" : ""}`}
            onClick={() => setExplorerOpen((value) => !value)}
            type="button"
          >
            Explorer
          </button>
          <button
            className={`chrome-toggle ${primaryView === "source-control" ? "is-on" : ""}`}
            onClick={() => {
              setPrimaryView("source-control");
              setExplorerOpen(true);
            }}
            type="button"
          >
            Source Control
          </button>
          <button
            className={`chrome-toggle ${bottomOpen ? "is-on" : ""}`}
            onClick={() => setBottomOpen((value) => !value)}
            type="button"
          >
            Terminal
          </button>
          <button
            className={`chrome-toggle ${dockOpen ? "is-on" : ""}`}
            onClick={() => setDockOpen((value) => !value)}
            type="button"
          >
            Chat
          </button>
          <button
            className="chrome-toggle"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            Settings
          </button>
          <span className={`chrome-pill ${snapshot.setupRequired ? "" : "accent"}`}>
            {snapshot.setupRequired ? "Provider setup" : "Ready"}
          </span>
        </div>
      </div>

      <div className={workbenchClassName}>
        {activityBarOpen ? (
          <aside className="activity-rail">
            {activityItems.map((item) => (
              <button
                className={`activity-button ${primaryView === item.id ? "is-active" : ""}`}
                key={item.id}
                onClick={() => {
                  setPrimaryView(item.id);
                  setExplorerOpen(true);
                }}
                type="button"
                title={item.label}
              >
                <span>{item.shortLabel}</span>
              </button>
            ))}
          </aside>
        ) : null}

        <aside className="pane explorer-pane">
          {renderPrimaryPane()}
        </aside>

        <main className="editor-column">
          <section className="editor-tabs">
            {editorTabs.map((tabPath) => (
              <button
                className={`editor-tab ${tabPath === activeFilePath ? "is-active" : ""}`}
                key={tabPath}
                onClick={() => void handleSelectFile(tabPath)}
                type="button"
              >
                {labelForFilePath(tabPath)}
              </button>
            ))}
          </section>

          <section className="editor-panel">
            <div className="editor-toolbar">
              <div className="breadcrumbs">{activeFilePath || "No file selected"}</div>
              <div className="editor-toolbar-right">
                <span className={`editor-badge ${editorDirty ? "" : "accent"}`}>
                  {editorDirty ? "Unsaved" : "Saved"}
                </span>
                <button className="secondary-button slim-button" onClick={() => void handleReloadFile()} type="button">
                  Reload
                </button>
                <button
                  className="primary-button slim-button"
                  disabled={saveBusy || !editorDirty}
                  onClick={() => void handleSaveFile()}
                  type="button"
                >
                  {saveBusy ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            <div className="editor-surface">
              {snapshot.setupRequired ? (
                <div className="setup-banner">
                  <div className="setup-copy">
                    <strong>Provider setup required</strong>
                    <p>
                      OpenGravity already prepared the compile-repair session. Connect a provider or local runtime to
                      continue the same task with your own credentials.
                    </p>
                  </div>
                  <button className="primary-button" onClick={() => setSettingsOpen(true)} type="button">
                    Open Provider Settings
                  </button>
                </div>
              ) : null}

              <div className="monaco-editor-shell">
                <Editor
                  beforeMount={configureOpenGravityTheme}
                  language={activeDocumentLanguage}
                  loading={<div className="editor-loading-state">Preparing editor</div>}
                  onChange={(value) =>
                    setOpenDocuments((current) =>
                      updateWorkspaceDocumentContent(current, activeFilePath, value ?? "")
                    )
                  }
                  options={editorOptions}
                  path={activeFilePath || "untitled.txt"}
                  saveViewState
                  theme="opengravity-dark"
                  value={activeDocument?.currentContent ?? ""}
                />
              </div>
            </div>
          </section>

          <section className={`bottom-drawer ${bottomOpen ? "is-open" : "is-collapsed"}`}>
            <div className="bottom-drawer-bar">
              <div className="drawer-tabs">
                <button
                  className={`drawer-tab ${bottomView === "terminal" ? "is-active" : ""}`}
                  onClick={() => {
                    setBottomView("terminal");
                    setBottomOpen(true);
                  }}
                  type="button"
                >
                  Terminal
                </button>
                <button
                  className={`drawer-tab ${bottomView === "build" ? "is-active" : ""}`}
                  onClick={() => {
                    setBottomView("build");
                    setBottomOpen(true);
                  }}
                  type="button"
                >
                  Build
                </button>
                <button
                  className={`drawer-tab ${bottomView === "tasks" ? "is-active" : ""}`}
                  onClick={() => {
                    setBottomView("tasks");
                    setBottomOpen(true);
                  }}
                  type="button"
                >
                  Tasks
                </button>
                <button
                  className={`drawer-tab ${bottomView === "events" ? "is-active" : ""}`}
                  onClick={() => {
                    setBottomView("events");
                    setBottomOpen(true);
                  }}
                  type="button"
                >
                  Events
                </button>
                <button
                  className={`drawer-tab ${bottomView === "log" ? "is-active" : ""}`}
                  onClick={() => {
                    setBottomView("log");
                    setBottomOpen(true);
                  }}
                  type="button"
                >
                  Log
                </button>
              </div>

              <button className="drawer-toggle" onClick={() => setBottomOpen((value) => !value)} type="button">
                {bottomOpen ? "Hide panel" : "Show panel"}
              </button>
            </div>

            {bottomOpen ? <div className="bottom-drawer-panel">{renderBottomContent()}</div> : null}
          </section>
        </main>

        <aside className="pane agent-dock">
          <div className="pane-header">
            <span>Agent</span>
            <span className="pane-meta">Focused assistant</span>
          </div>

          <div className="pane-scroll">
            <section className="section-block">
              <div className="composer-card">
                <div className="composer-top">
                  <strong>OpenGravity Chat</strong>
                  <span className={`state-pill ${chatBusy ? "is-running" : taskTone(runningTask?.status ?? "queued")}`}>
                    {chatBusy ? "thinking" : chatMode}
                  </span>
                </div>

                <div className="chat-mode-tabs">
                  {(["ask", "planning", "agent"] as ChatMode[]).map((mode) => (
                    <button
                      className={`chat-mode-tab ${chatMode === mode ? "is-active" : ""}`}
                      key={mode}
                      onClick={() => setChatMode(mode)}
                      type="button"
                    >
                      {mode === "ask" ? "Ask" : mode === "planning" ? "Planning" : "Agent"}
                    </button>
                  ))}
                </div>

                <p className="composer-summary">{getChatModeDescription(chatMode)}</p>

                <div className="chat-toolbar-grid">
                  <div className="chat-toolbar-field">
                    <span className="field-label">Provider</span>
                    <select
                      className="settings-input chat-compact-input"
                      onChange={(event) => handleQuickConnectProvider(event.target.value as ModelProvider)}
                      value={quickSetupProfile?.provider ?? ""}
                    >
                      {compatibleChatProfiles.map((profile) => (
                        <option key={profile.provider} value={profile.provider}>
                          {profile.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="chat-toolbar-field">
                    <span className="field-label">Model</span>
                    <select
                      className="settings-input chat-compact-input"
                      disabled={!quickSetupProfile || quickSetupModels.length === 0}
                      onChange={(event) => handleQuickConnectModelChange(event.target.value)}
                      value={quickSetupProfile?.preferredModelId ?? ""}
                    >
                      {quickSetupModels.length === 0 ? <option value="">No models available</option> : null}
                      {quickSetupModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="chat-toolbar-field">
                    <span className="field-label">Account</span>
                    <div className="chat-toolbar-inline">
                      <select
                        className="settings-input chat-compact-input"
                        disabled={!quickSetupProfile || quickSetupAccounts.length === 0}
                        onChange={(event) => setSelectedAccountId(event.target.value)}
                        value={quickSetupAccount?.id ?? ""}
                      >
                        {quickSetupAccounts.length === 0 ? <option value="">No account</option> : null}
                        {quickSetupAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="secondary-button slim-button"
                        onClick={() => {
                          if (!quickSetupProfile) {
                            return;
                          }

                          setSettings((current) => addProviderAccount(current, quickSetupProfile.provider));
                          setWorkspaceNotice(`Added another ${quickSetupProfile.label} account.`);
                        }}
                        type="button"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="chat-toolbar-field">
                    <span className="field-label">Action approvals</span>
                    <select
                      className="settings-input chat-compact-input"
                      onChange={(event) =>
                        setPermissionSettings((current) => ({
                          ...current,
                          profile: event.target.value as PermissionProfile
                        }))
                      }
                      value={permissionSettings.profile}
                    >
                      {approvalProfiles.map((profile) => (
                        <option key={profile} value={profile}>
                          {getPermissionProfileLabel(profile)}
                        </option>
                      ))}
                    </select>
                    <div className="field-help approval-help">
                      {getPermissionProfileDescription(permissionSettings.profile)}
                    </div>
                  </div>
                </div>

                <div className="chat-toolbar-actions">
                  <label className="toggle-row compact-toggle">
                    <input
                      checked={settings.autoHandoff}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          autoHandoff: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span>Auto handoff</span>
                  </label>

                  <label className="toggle-row compact-toggle">
                    <input
                      checked={settings.parallelAgentMode}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          parallelAgentMode: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span>Parallel agents</span>
                  </label>

                  <select
                    className="settings-input chat-mini-select"
                    disabled={!settings.parallelAgentMode}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        concurrentAgentCount: Number.parseInt(event.target.value, 10) || 1
                      }))
                    }
                    value={String(settings.concurrentAgentCount)}
                  >
                    {[1, 2, 3, 4, 5, 6].map((count) => (
                      <option key={count} value={count}>
                        {count} lane{count === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>

                  <button className="secondary-button slim-button" onClick={() => setSettingsOpen(true)} type="button">
                    Settings
                  </button>
                  <button className="secondary-button slim-button" onClick={() => handleClearChatHistory()} type="button">
                    Clear history
                  </button>
                  <button
                    className="secondary-button slim-button"
                    disabled={rememberedApprovalCount === 0}
                    onClick={() => {
                      setPermissionSettings((current) => clearRememberedApprovals(current));
                      setWorkspaceNotice("Cleared trusted action approvals for this workspace.");
                    }}
                    type="button"
                  >
                    Clear trusted actions
                  </button>
                </div>

                {!quickSetupProfile ||
                getProviderConnectionState(quickSetupProfile, settings) !== "ready" ||
                !quickSetupAccount?.apiKey.trim() ? (
                  <div className="quick-connect-card">
                    <div className="settings-section-headline">
                      <div>
                        <div className="settings-provider-title">Quick Connect</div>
                        <div className="settings-provider-copy">
                          Paste a key, pick a model, and OpenGravity will save it locally on this machine.
                        </div>
                      </div>
                      <span className={`state-pill ${quickSetupProfile ? connectionTone(quickSetupProfile, settings) : "is-waiting"}`}>
                        {quickSetupProfile ? getProviderConnectionLabel(quickSetupProfile, settings) : "No provider"}
                      </span>
                    </div>

                    <div className="settings-field">
                      <label className="field-label" htmlFor="quick-connect-key">
                        API key
                      </label>
                      <div className="secret-row">
                        <input
                          id="quick-connect-key"
                          className="settings-input"
                          onChange={(event) => updateQuickConnectAccount({ apiKey: event.target.value, enabled: true })}
                          placeholder={
                            quickSetupProfile
                              ? `Paste the ${quickSetupProfile.label} API key for ${quickSetupAccount?.label ?? "this account"}`
                              : "Paste an API key"
                          }
                          type={visibleSecrets.quickConnect ? "text" : "password"}
                          value={quickSetupAccount?.apiKey ?? ""}
                        />
                        <button
                          className="secondary-button"
                          onClick={() =>
                            setVisibleSecrets((current) => ({
                              ...current,
                              quickConnect: !current.quickConnect
                            }))
                          }
                          type="button"
                        >
                          {visibleSecrets.quickConnect ? "Hide" : "Show"}
                        </button>
                      </div>
                      <div className="field-help">Saved locally as you type. Nothing is committed to the repository.</div>
                    </div>

                    {showQuickBaseUrl && quickSetupProfile ? (
                      <div className="settings-field">
                        <label className="field-label" htmlFor="quick-connect-base-url">
                          Base URL
                        </label>
                        <input
                          id="quick-connect-base-url"
                          className="settings-input"
                          onChange={(event) => updateQuickConnectAccount({ baseUrl: event.target.value })}
                          placeholder="Enter the endpoint base URL"
                          value={quickSetupAccount?.baseUrl ?? ""}
                        />
                      </div>
                    ) : null}

                    <div className="quick-connect-actions">
                      <button className="primary-button slim-button" onClick={() => handleQuickConnectReady()} type="button">
                        Save and connect
                      </button>
                      <button className="secondary-button slim-button" onClick={() => setSettingsOpen(true)} type="button">
                        Open full settings
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="chat-history">
                  {chatMessages.map((message) => (
                    <div className={`chat-message is-${message.role}`} key={message.id}>
                      <div className="chat-message-meta">
                        <strong>{message.role === "user" ? "You" : message.role === "assistant" ? "OpenGravity" : "System"}</strong>
                        <span>
                          {new Date(message.timestamp).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </span>
                        {message.agentRole ? <span>{message.agentRole}</span> : null}
                        {message.accountLabel ? <span>{message.accountLabel}</span> : null}
                        {message.modelId ? <span>{message.modelId}</span> : null}
                      </div>
                      <div className="chat-message-body">{message.content}</div>
                      {message.actionPlan ? (
                        <div className="chat-action-plan">
                          <div className="chat-action-plan-head">
                            <strong>{message.actionPlan.summary}</strong>
                            <span className="signal-pill">{message.actionPlan.actions.length} actions</span>
                          </div>
                          <div className="chat-action-list">
                            {message.actionPlan.actions.map((action) => {
                              const permissionDecision = evaluateAgentActionPermission(action, permissionSettings);
                              const actionStatus = agentActionStatuses[action.id] ?? (permissionDecision === "deny" ? "blocked" : "idle");
                              return (
                                <div className="chat-action-row" key={action.id}>
                                  <div className="compact-copy">
                                    <strong>{action.label}</strong>
                                    <span>
                                      {action.description ??
                                        action.command ??
                                        action.path ??
                                        (action.workflow === "recommended"
                                          ? "Run the recommended workflow"
                                          : action.type)}
                                    </span>
                                  </div>
                                  <div className="chat-action-row-right">
                                    <span className={`state-pill ${permissionDecisionTone(permissionDecision)}`}>
                                      {getPermissionDecisionLabel(permissionDecision)}
                                    </span>
                                    <span className={`state-pill ${actionStatusTone(actionStatus)}`}>
                                      {actionStatus}
                                    </span>
                                    {permissionDecision === "ask" ? (
                                      <button
                                        className="secondary-button slim-button"
                                        disabled={actionStatus === "running"}
                                        onClick={() => void handleTrustAgentAction(action)}
                                        type="button"
                                      >
                                        Trust
                                      </button>
                                    ) : null}
                                    <button
                                      className="secondary-button slim-button"
                                      disabled={actionStatus === "running" || permissionDecision === "deny"}
                                      onClick={() => void handleApplyAgentAction(action)}
                                      type="button"
                                    >
                                      {permissionDecision === "deny"
                                        ? "Blocked"
                                        : action.type === "open_file"
                                          ? "Open"
                                          : action.type === "run_command"
                                            ? "Run"
                                            : "Start"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <textarea
                  className="composer-input"
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder={getChatComposerPlaceholder(chatMode)}
                  value={chatInput}
                />

                <div className="composer-actions">
                  <button
                    className="primary-button slim-button"
                    disabled={chatBusy || chatInput.trim().length === 0}
                    onClick={() => void handleSendChat()}
                    type="button"
                  >
                    {chatBusy ? "Sending..." : "Send"}
                  </button>
                  <button
                    className="secondary-button slim-button"
                    onClick={() => {
                      setBottomView("terminal");
                      setBottomOpen(true);
                    }}
                    type="button"
                  >
                    Open terminal
                  </button>
                  <button
                    className="secondary-button slim-button"
                    disabled={
                      snapshot.setupRequired ||
                      terminalBusy ||
                      workflowDispatchBusy ||
                      !canRunAgentWorkflow(chatMode)
                    }
                    onClick={() => handleStartWorkflow()}
                    type="button"
                  >
                    Run suggested plan
                  </button>
                </div>
                <div className="composer-footer">
                  <span>
                    {chatAccounts.length > 0
                      ? `${chatAccounts.length} account${chatAccounts.length === 1 ? "" : "s"} ready`
                      : "No provider connected"}
                  </span>
                  <span>{chatHistoryReady ? "History saved per workspace" : "Preparing chat history"}</span>
                  <span>
                    {settings.parallelAgentMode && chatMode === "agent"
                      ? `${settings.concurrentAgentCount} parallel lane${settings.concurrentAgentCount === 1 ? "" : "s"}`
                      : "Single response mode"}
                  </span>
                  <span>
                    {rememberedApprovalCount > 0
                      ? `${rememberedApprovalCount} trusted action${rememberedApprovalCount === 1 ? "" : "s"}`
                      : "No trusted actions yet"}
                  </span>
                  <span>
                    {customRuleCount > 0
                      ? `${customRuleCount} custom rule${customRuleCount === 1 ? "" : "s"}`
                      : "Profile-only approvals"}
                  </span>
                </div>

                <div className="provider-radar-card">
                  <div className="settings-section-headline">
                    <div>
                      <div className="section-label">Provider radar</div>
                      <div className="settings-provider-copy">
                        Borrowed from Antigravity-Manager: keep the best ready route, active route, and fallback visible.
                      </div>
                    </div>
                    <button
                      className="secondary-button slim-button"
                      disabled={!providerRadar.recommended}
                      onClick={() => handleUseRecommendedProvider()}
                      type="button"
                    >
                      Use recommended
                    </button>
                  </div>

                  <div className="provider-radar-grid">
                    <div className="summary-card">
                      <strong>{providerRadar.recommended?.label ?? "No recommended route yet"}</strong>
                      <p>
                        {providerRadar.recommended
                          ? `${providerRadar.recommended.preferredModelLabel} · ${providerRadar.recommended.readyAccountCount} ready account${providerRadar.recommended.readyAccountCount === 1 ? "" : "s"}`
                          : "Connect a provider account to unlock smart routing recommendations."}
                      </p>
                      <span className={`state-pill ${providerRadar.recommended ? permissionDecisionTone("allow") : "is-waiting"}`}>
                        {providerRadar.recommended?.connectionLabel ?? "setup required"}
                      </span>
                    </div>

                    <div className="summary-card">
                      <strong>{providerRadar.active?.label ?? "No active route"}</strong>
                      <p>
                        {providerRadar.active
                          ? `${providerRadar.active.preferredModelLabel} · ${providerRadar.active.healthReason}`
                          : "The active route appears after a provider and model are ready."}
                      </p>
                      <span className={`state-pill ${providerRadar.active ? permissionDecisionTone("ask") : "is-waiting"}`}>
                        {providerRadar.active?.healthState ?? "idle"}
                      </span>
                    </div>
                  </div>

                  <div className="provider-radar-footer">
                    <span>{`${providerRadar.readyProviderCount} provider${providerRadar.readyProviderCount === 1 ? "" : "s"} ready`}</span>
                    <span>{`${providerRadar.readyAccountCount} account${providerRadar.readyAccountCount === 1 ? "" : "s"} ready`}</span>
                    <span>{providerRadar.fallback ? `Fallback: ${providerRadar.fallback.label}` : "No fallback route yet"}</span>
                  </div>
                </div>

                <div className="approval-rules-card">
                  <div className="settings-section-headline">
                    <div>
                      <div className="section-label">Approval rules</div>
                      <div className="settings-provider-copy">
                        Workspace rules sit above the profile. Use them to always allow, review, or block specific command or workflow patterns.
                      </div>
                    </div>
                    <div className="settings-inline-actions">
                      <span className={`state-pill ${customRuleCount > 0 ? "is-done" : "is-waiting"}`}>
                        {customRuleCount} custom
                      </span>
                      <button
                        className="secondary-button slim-button"
                        disabled={customRuleCount === 0}
                        onClick={() => {
                          setPermissionSettings((current) => clearPermissionRules(current));
                          setWorkspaceNotice("Cleared custom approval rules for this workspace.");
                        }}
                        type="button"
                      >
                        Clear rules
                      </button>
                    </div>
                  </div>

                  <div className="approval-rule-toolbar">
                    <select
                      className="settings-input chat-mini-select"
                      onChange={(event) => setPermissionRuleSubjectDraft(event.target.value as PermissionRuleSubject)}
                      value={permissionRuleSubjectDraft}
                    >
                      <option value="run_command">Command</option>
                      <option value="run_workflow">Workflow</option>
                    </select>
                    <input
                      className="settings-input approval-rule-pattern"
                      onChange={(event) => setPermissionRulePatternDraft(event.target.value)}
                      placeholder={getPermissionRulePatternPlaceholder(permissionRuleSubjectDraft)}
                      value={permissionRulePatternDraft}
                    />
                    <select
                      className="settings-input chat-mini-select"
                      onChange={(event) => setPermissionRuleActionDraft(event.target.value as PermissionAction)}
                      value={permissionRuleActionDraft}
                    >
                      <option value="allow">Allow</option>
                      <option value="ask">Ask</option>
                      <option value="deny">Deny</option>
                    </select>
                    <button className="secondary-button slim-button" onClick={() => handleAddPermissionRule()} type="button">
                      Add rule
                    </button>
                  </div>

                  <div className="approval-rule-examples">
                    Examples: <code>rg *</code>, <code>cmake *</code>, <code>recommended</code>
                  </div>

                  {customRuleCount === 0 ? (
                    <div className="settings-empty-state">
                      No custom rules yet. The active profile still blocks dangerous commands and auto-runs only what is safe.
                    </div>
                  ) : (
                    <div className="compact-list compact-list-tight">
                      {permissionSettings.customRules.map((rule) => (
                        <div className="compact-row" key={rule.id}>
                          <div className="compact-copy">
                            <strong>{getPermissionRuleSubjectLabel(rule.subject)}</strong>
                            <span>{rule.pattern}</span>
                          </div>
                          <div className="chat-action-row-right">
                            <span className={`state-pill ${permissionDecisionTone(rule.action)}`}>
                              {getPermissionDecisionLabel(rule.action)}
                            </span>
                            <button
                              className="secondary-button slim-button"
                              onClick={() => handleRemovePermissionRule(rule.id)}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="section-block">
              <div className="settings-section-headline">
                <div>
                  <div className="section-label">Session details</div>
                  <div className="settings-provider-copy">
                    Keep the chat focused. Expand this only when you need runtime context.
                  </div>
                </div>
                <button
                  className="secondary-button slim-button"
                  onClick={() => setAgentDetailsOpen((value) => !value)}
                  type="button"
                >
                  {agentDetailsOpen ? "Hide" : "Show"}
                </button>
              </div>

              {agentDetailsOpen ? (
                <>
                  <div className="side-tabs">
                    <button
                      className={`side-tab ${sideView === "overview" ? "is-active" : ""}`}
                      onClick={() => setSideView("overview")}
                      type="button"
                    >
                      Overview
                    </button>
                    <button
                      className={`side-tab ${sideView === "handoff" ? "is-active" : ""}`}
                      onClick={() => setSideView("handoff")}
                      type="button"
                    >
                      Handoff
                    </button>
                    <button
                      className={`side-tab ${sideView === "artifacts" ? "is-active" : ""}`}
                      onClick={() => setSideView("artifacts")}
                      type="button"
                    >
                      Artifacts
                    </button>
                    <button
                      className={`side-tab ${sideView === "runtime" ? "is-active" : ""}`}
                      onClick={() => setSideView("runtime")}
                      type="button"
                    >
                      Runtime
                    </button>
                  </div>

                  <div className="side-panel">{renderSideView()}</div>
                </>
              ) : null}
            </section>
          </div>
        </aside>
      </div>

      {statusBarOpen ? (
        <footer className="statusbar">
          <span>{labelForFilePath(activeFilePath || workspace.rootPath)}</span>
          <span>{dirtyDocumentCount > 0 ? `${dirtyDocumentCount} dirty buffers` : "All buffers saved"}</span>
          <span>{repository.branch || "No git branch"}</span>
        </footer>
      ) : null}

      {layoutOpen ? (
        <div className="settings-scrim" onClick={() => setLayoutOpen(false)} role="presentation">
          <section
            aria-label="Customize Layout"
            className="layout-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-header">
              <div>
                <div className="settings-title">Customize Layout</div>
                <div className="settings-subtitle">Choose which desktop surfaces stay visible while you work.</div>
              </div>
              <button className="secondary-button" onClick={() => setLayoutOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="layout-panel-body">
              <label className="toggle-row">
                <input
                  checked={activityBarOpen}
                  onChange={(event) => setActivityBarOpen(event.target.checked)}
                  type="checkbox"
                />
                <span>Activity Bar</span>
              </label>
              <label className="toggle-row">
                <input
                  checked={explorerOpen}
                  onChange={(event) => setExplorerOpen(event.target.checked)}
                  type="checkbox"
                />
                <span>Primary Side Bar</span>
              </label>
              <label className="toggle-row">
                <input
                  checked={dockOpen}
                  onChange={(event) => setDockOpen(event.target.checked)}
                  type="checkbox"
                />
                <span>Secondary Side Bar</span>
              </label>
              <label className="toggle-row">
                <input
                  checked={bottomOpen}
                  onChange={(event) => setBottomOpen(event.target.checked)}
                  type="checkbox"
                />
                <span>Panel</span>
              </label>
              <label className="toggle-row">
                <input
                  checked={statusBarOpen}
                  onChange={(event) => setStatusBarOpen(event.target.checked)}
                  type="checkbox"
                />
                <span>Status Bar</span>
              </label>

              <div className="layout-panel-actions">
                <button
                  className="secondary-button slim-button"
                  onClick={() => {
                    setActivityBarOpen(true);
                    setExplorerOpen(true);
                    setDockOpen(true);
                    setBottomOpen(true);
                    setStatusBarOpen(true);
                  }}
                  type="button"
                >
                  Reset to default
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen && selectedProfile ? (
        <div className="settings-scrim" onClick={() => setSettingsOpen(false)} role="presentation">
          <section
            aria-label="Provider Settings"
            className="settings-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-header">
              <div>
                <div className="settings-title">Provider Settings</div>
                <div className="settings-subtitle">Use your own API keys, local runtimes, and fallback rules.</div>
              </div>
              <div className="settings-header-actions">
                <div className="settings-view-toggle">
                  <button
                    className={`secondary-button slim-button ${settingsView === "providers" ? "is-active" : ""}`}
                    onClick={() => setSettingsView("providers")}
                    type="button"
                  >
                    Providers
                  </button>
                  <button
                    className={`secondary-button slim-button ${settingsView === "skills" ? "is-active" : ""}`}
                    onClick={() => setSettingsView("skills")}
                    type="button"
                  >
                    Skills
                  </button>
                  <button
                    className={`secondary-button slim-button ${settingsView === "integrations" ? "is-active" : ""}`}
                    onClick={() => setSettingsView("integrations")}
                    type="button"
                  >
                    Integrations
                  </button>
                </div>
                <button className="secondary-button" onClick={() => setSettingsOpen(false)} type="button">
                  Close
                </button>
              </div>
            </div>

            <div className="settings-layout">
              <aside className="settings-sidebar">
                {settingsView === "providers" ? (
                  <>
                    <section className="settings-section">
                      <div className="settings-section-label">Workspace routing</div>
                      <div className="settings-field">
                        <label className="field-label" htmlFor="active-model">
                          Active model
                        </label>
                        <select
                          id="active-model"
                          className="settings-input"
                          disabled={availableModelIds.size === 0}
                          onChange={(event) =>
                            setSettings((current) => setActiveModel(current, event.target.value, snapshot.models))
                          }
                          value={availableModelIds.has(settings.activeModelId) ? settings.activeModelId : ""}
                        >
                          {availableModelIds.size === 0 ? <option value="">Connect a provider first</option> : null}
                          {snapshot.models
                            .filter((model) => availableModelIds.has(model.id))
                            .map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.label}
                              </option>
                            ))}
                        </select>
                      </div>

                      <label className="toggle-row">
                        <input
                          checked={settings.autoHandoff}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              autoHandoff: event.target.checked
                            }))
                          }
                          type="checkbox"
                        />
                        <span>Allow automatic provider handoff</span>
                      </label>
                    </section>

                    <section className="settings-section">
                      <div className="settings-section-label">Providers</div>
                      <div className="provider-list">
                        {settings.providerProfiles.map((profile) => (
                          <button
                            className={`provider-list-item ${profile.provider === selectedProvider ? "is-active" : ""}`}
                            key={profile.provider}
                            onClick={() => setSelectedProvider(profile.provider)}
                            type="button"
                          >
                            <div className="provider-list-copy">
                              <strong>{profile.label}</strong>
                              <span>{getProviderConnectionLabel(profile, settings)}</span>
                            </div>
                            <span className={`state-pill ${connectionTone(profile, settings)}`}>
                              {getProviderConnectionState(profile, settings).replaceAll("-", " ")}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </>
                ) : settingsView === "skills" ? (
                  <section className="settings-section">
                    <div className="settings-section-headline">
                      <div>
                        <div className="settings-provider-title">Local Skills</div>
                        <div className="settings-provider-copy">
                          Register external tools without hardcoding them into the app.
                        </div>
                      </div>
                      <button
                        className="secondary-button slim-button"
                        onClick={() => setSkills((current) => addLocalSkill(current))}
                        type="button"
                      >
                        Add skill
                      </button>
                    </div>

                    <div className="provider-list">
                      {skills.length === 0 ? (
                        <div className="settings-empty-state">
                          Add tools such as Ghidra, x64dbg, or any custom local utility.
                        </div>
                      ) : (
                        skills.map((skill) => (
                          <button
                            className={`provider-list-item ${skill.id === selectedSkillId ? "is-active" : ""}`}
                            key={skill.id}
                            onClick={() => setSelectedSkillId(skill.id)}
                            type="button"
                          >
                            <div className="provider-list-copy">
                              <strong>{skill.label}</strong>
                              <span>{skill.executablePath || "Executable path not set"}</span>
                            </div>
                            <span className={`state-pill ${skill.enabled ? "is-done" : "is-waiting"}`}>
                              {skill.enabled ? "enabled" : "disabled"}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </section>
                ) : (
                  <section className="settings-section">
                    <div className="settings-section">
                      <div className="settings-section-headline">
                        <div>
                          <div className="settings-provider-title">GitHub</div>
                          <div className="settings-provider-copy">
                            Connect GitHub signals to the Source Control panel without hardcoding anything.
                          </div>
                        </div>
                        <span className={`state-pill ${githubRemote ? "is-done" : "is-waiting"}`}>
                          {githubRemote ? "remote detected" : "no remote"}
                        </span>
                      </div>

                      <div className="provider-list">
                        <button className="provider-list-item is-active" type="button">
                          <div className="provider-list-copy">
                            <strong>{githubRemote ? `${githubRemote.owner}/${githubRemote.repo}` : "GitHub signals"}</strong>
                            <span>{githubRemote ? githubRemote.url : "Add a GitHub remote or use a public repository."}</span>
                          </div>
                          <span className="state-pill is-running">{githubSignalsLabel}</span>
                        </button>
                      </div>
                    </div>
                  </section>
                )}
              </aside>

              <div className="settings-detail">
                {settingsView === "providers" ? (
                  <section className="settings-section">
                    <div className="settings-section-headline">
                      <div>
                        <div className="settings-provider-title">{selectedProfile.label}</div>
                        <div className="settings-provider-copy">
                          {getProviderConnectionLabel(selectedProfile, settings)}
                        </div>
                      </div>
                      <span className={`state-pill ${connectionTone(selectedProfile, settings)}`}>
                        {getProviderConnectionState(selectedProfile, settings).replaceAll("-", " ")}
                      </span>
                    </div>

                    <label className="toggle-row">
                      <input
                        checked={selectedProfile.enabled}
                        onChange={(event) => updateSelectedProvider({ enabled: event.target.checked })}
                        type="checkbox"
                      />
                      <span>Enable this provider</span>
                    </label>

                    <div className="settings-grid-two">
                      <div className="settings-field">
                        <label className="field-label" htmlFor={`provider-model-${selectedProfile.provider}`}>
                          Preferred model
                        </label>
                        {selectedProfile.provider === "custom" ? (
                          <input
                            id={`provider-model-${selectedProfile.provider}`}
                            className="settings-input"
                            onChange={(event) => updateSelectedProvider({ preferredModelId: event.target.value })}
                            placeholder="Enter any OpenAI-compatible model id"
                            value={selectedProfile.preferredModelId}
                          />
                        ) : (
                          <select
                            id={`provider-model-${selectedProfile.provider}`}
                            className="settings-input"
                            onChange={(event) => updateSelectedProvider({ preferredModelId: event.target.value })}
                            value={selectedProfile.preferredModelId}
                          >
                            {selectedProviderModels.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      <label className="toggle-row compact-toggle">
                        <input
                          checked={selectedProfile.allowFallback}
                          onChange={(event) => updateSelectedProvider({ allowFallback: event.target.checked })}
                          type="checkbox"
                        />
                        <span>Allow fallback routing</span>
                      </label>
                    </div>

                    <div className="settings-section catalog-section">
                      <div className="settings-section-headline">
                        <div>
                          <div className="settings-provider-title">Accounts</div>
                          <div className="settings-provider-copy">
                            Add multiple keys for the same provider and let OpenGravity rotate across them.
                          </div>
                        </div>
                        <button className="secondary-button" onClick={() => handleAddProviderAccount()} type="button">
                          Add account
                        </button>
                      </div>

                      <div className="provider-list">
                        {selectedProviderAccounts.map((account) => {
                          const ready = selectedReadyAccounts.some((entry) => entry.id === account.id);
                          const primary = selectedProfile.primaryAccountId === account.id;
                          return (
                            <button
                              className={`provider-list-item ${account.id === selectedAccount?.id ? "is-active" : ""}`}
                              key={account.id}
                              onClick={() => setSelectedAccountId(account.id)}
                              type="button"
                            >
                              <div className="provider-list-copy">
                                <strong>{account.label}</strong>
                                <span>
                                  {primary ? "Primary account" : "Secondary account"}
                                  {account.baseUrl ? ` · ${account.baseUrl}` : ""}
                                </span>
                              </div>
                              <span className={`state-pill ${ready ? "is-done" : "is-waiting"}`}>
                                {ready ? "ready" : account.enabled ? "incomplete" : "disabled"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {selectedAccount ? (
                      <div className="settings-section catalog-section">
                        <div className="settings-section-headline">
                          <div>
                            <div className="settings-provider-title">{selectedAccount.label}</div>
                            <div className="settings-provider-copy">
                              {selectedProfile.primaryAccountId === selectedAccount.id
                                ? "This account is the current primary route."
                                : "This account can be used as a fallback or promoted to primary."}
                            </div>
                          </div>
                          <div className="settings-inline-actions">
                            <button
                              className="secondary-button slim-button"
                              disabled={selectedProfile.primaryAccountId === selectedAccount.id}
                              onClick={() => handleSetPrimaryAccount()}
                              type="button"
                            >
                              Make primary
                            </button>
                            <button
                              className="secondary-button slim-button"
                              disabled={selectedProviderAccounts.length <= 1}
                              onClick={() => handleRemoveSelectedAccount()}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="settings-field">
                          <label className="field-label" htmlFor={`provider-account-label-${selectedAccount.id}`}>
                            Account label
                          </label>
                          <input
                            id={`provider-account-label-${selectedAccount.id}`}
                            className="settings-input"
                            onChange={(event) => updateSelectedAccount({ label: event.target.value })}
                            value={selectedAccount.label}
                          />
                        </div>

                        <label className="toggle-row">
                          <input
                            checked={selectedAccount.enabled}
                            onChange={(event) => updateSelectedAccount({ enabled: event.target.checked })}
                            type="checkbox"
                          />
                          <span>Enable this account</span>
                        </label>

                        <div className="settings-field">
                          <label className="field-label" htmlFor={`provider-key-${selectedAccount.id}`}>
                            {selectedProfile.provider === "ollama" ? "Runtime token" : "API key"}
                          </label>
                          <div className="secret-row">
                            <input
                              id={`provider-key-${selectedAccount.id}`}
                              className="settings-input"
                              onChange={(event) => updateSelectedAccount({ apiKey: event.target.value })}
                              placeholder={
                                selectedProfile.provider === "ollama"
                                  ? "Optional for authenticated local runtimes"
                                  : `Paste the ${selectedProfile.label} API key for this account`
                              }
                              type={visibleSecrets[selectedAccount.id] ? "text" : "password"}
                              value={selectedAccount.apiKey}
                            />
                            <button
                              className="secondary-button"
                              onClick={() =>
                                setVisibleSecrets((current) => ({
                                  ...current,
                                  [selectedAccount.id]: !current[selectedAccount.id]
                                }))
                              }
                              type="button"
                            >
                              {visibleSecrets[selectedAccount.id] ? "Hide" : "Show"}
                            </button>
                          </div>
                          <div className="field-help">
                            {selectedAccount.apiKey
                              ? `Stored locally for this prototype: ${maskSecret(selectedAccount.apiKey)}`
                              : "No key stored yet."}
                          </div>
                        </div>

                        <div className="settings-field">
                          <label className="field-label" htmlFor={`provider-url-${selectedAccount.id}`}>
                            Base URL
                          </label>
                          <input
                            id={`provider-url-${selectedAccount.id}`}
                            className="settings-input"
                            onChange={(event) => updateSelectedAccount({ baseUrl: event.target.value })}
                            placeholder={
                              selectedProfile.provider === "ollama"
                                ? "http://127.0.0.1:11434/v1"
                                : selectedProfile.provider === "gemini"
                                  ? "https://generativelanguage.googleapis.com/v1beta/openai"
                                : selectedProfile.provider === "groq"
                                  ? "https://api.groq.com/openai/v1"
                                : selectedProfile.provider === "openrouter"
                                  ? "https://openrouter.ai/api/v1"
                                  : selectedProfile.provider === "openai"
                                    ? "https://api.openai.com/v1"
                                  : "https://api.example.com/v1"
                            }
                            value={selectedAccount.baseUrl}
                          />
                          <div className="field-help">
                            {selectedProfile.provider === "anthropic" ||
                            selectedProfile.provider === "gemini" ||
                            selectedProfile.provider === "groq" ||
                            selectedProfile.provider === "openai"
                              ? "The default endpoint is prefilled. Change it only if you are using a proxy or compatible endpoint."
                              : "Required for OpenRouter, local runtimes, and compatible endpoints."}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {selectedProviderSupportsCatalog ? (
                      <div className="settings-section catalog-section">
                        <div className="settings-section-headline">
                          <div>
                            <div className="settings-provider-title">OpenRouter Catalog</div>
                            <div className="settings-provider-copy">
                              Discover live models from the OpenRouter `/models` endpoint and surface current free options.
                            </div>
                          </div>
                          <button
                            className="secondary-button"
                            disabled={selectedProviderCatalogBusy}
                            onClick={() => void handleDiscoverOpenRouterModels()}
                            type="button"
                          >
                            {selectedProviderCatalogBusy ? "Refreshing..." : "Refresh Catalog"}
                          </button>
                        </div>

                        <div className="catalog-summary-row">
                          <span className="state-pill accent">
                            {openRouterCatalog ? `${openRouterCatalog.models.length} models` : "No live catalog yet"}
                          </span>
                          <span className="state-pill is-done">
                            {openRouterCatalog ? `${openRouterCatalog.freeCount} free` : "Refresh to list free models"}
                          </span>
                        </div>

                        {providerCatalogError ? <div className="workflow-warning">{providerCatalogError}</div> : null}

                        {openRouterCatalog ? (
                          <div className="catalog-list">
                            {openRouterFreeModels.map((model) => (
                              <button
                                className={`catalog-list-item ${
                                  selectedProfile.preferredModelId === model.id ? "is-active" : ""
                                }`}
                                key={model.id}
                                onClick={() => updateSelectedProvider({ preferredModelId: model.id })}
                                type="button"
                              >
                                <div className="catalog-list-copy">
                                  <strong>{model.label}</strong>
                                  <span>{model.id}</span>
                                </div>
                                <div className="catalog-list-tags">
                                  <span className="signal-pill">{`${Math.round(model.maxContextWindow / 1024)}k context`}</span>
                                  <span className="state-pill is-done">free</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                ) : settingsView === "skills" ? (
                  <section className="settings-section">
                    <div className="settings-section-headline">
                      <div>
                        <div className="settings-provider-title">
                          {selectedSkill?.label ?? "No skill selected"}
                        </div>
                        <div className="settings-provider-copy">
                          Skills are user-defined external tools. Nothing is hardcoded into OpenGravity.
                        </div>
                      </div>
                      <div className="settings-inline-actions">
                        <button
                          className="secondary-button slim-button"
                          disabled={!selectedSkill || !selectedSkill.enabled || !selectedSkill.executablePath}
                          onClick={() => void handleLaunchSkill()}
                          type="button"
                        >
                          Launch
                        </button>
                        <button
                          className="secondary-button slim-button"
                          disabled={!selectedSkill}
                          onClick={() =>
                            setSkills((current) =>
                              selectedSkill ? removeLocalSkill(current, selectedSkill.id) : current
                            )
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {selectedSkill ? (
                      <>
                        <label className="toggle-row">
                          <input
                            checked={selectedSkill.enabled}
                            onChange={(event) =>
                              setSkills((current) =>
                                updateLocalSkill(current, selectedSkill.id, { enabled: event.target.checked })
                              )
                            }
                            type="checkbox"
                          />
                          <span>Enable this skill</span>
                        </label>

                        <div className="settings-field">
                          <label className="field-label" htmlFor={`skill-label-${selectedSkill.id}`}>
                            Label
                          </label>
                          <input
                            id={`skill-label-${selectedSkill.id}`}
                            className="settings-input"
                            onChange={(event) =>
                              setSkills((current) =>
                                updateLocalSkill(current, selectedSkill.id, { label: event.target.value })
                              )
                            }
                            value={selectedSkill.label}
                          />
                        </div>

                        <div className="settings-field">
                          <label className="field-label" htmlFor={`skill-description-${selectedSkill.id}`}>
                            Description
                          </label>
                          <textarea
                            id={`skill-description-${selectedSkill.id}`}
                            className="settings-textarea"
                            onChange={(event) =>
                              setSkills((current) =>
                                updateLocalSkill(current, selectedSkill.id, { description: event.target.value })
                              )
                            }
                            placeholder="Explain what this tool is for"
                            value={selectedSkill.description}
                          />
                        </div>

                        <div className="settings-field">
                          <label className="field-label" htmlFor={`skill-path-${selectedSkill.id}`}>
                            Executable path
                          </label>
                          <input
                            id={`skill-path-${selectedSkill.id}`}
                            className="settings-input"
                            onChange={(event) =>
                              setSkills((current) =>
                                updateLocalSkill(current, selectedSkill.id, { executablePath: event.target.value })
                              )
                            }
                            placeholder="C:/Tools/MyTool/tool.exe"
                            value={selectedSkill.executablePath}
                          />
                        </div>

                        <div className="settings-field">
                          <label className="field-label" htmlFor={`skill-dir-${selectedSkill.id}`}>
                            Working directory
                          </label>
                          <input
                            id={`skill-dir-${selectedSkill.id}`}
                            className="settings-input"
                            onChange={(event) =>
                              setSkills((current) =>
                                updateLocalSkill(current, selectedSkill.id, { workingDirectory: event.target.value })
                              )
                            }
                            placeholder="Optional working directory"
                            value={selectedSkill.workingDirectory}
                          />
                        </div>

                        <div className="settings-field">
                          <label className="field-label" htmlFor={`skill-args-${selectedSkill.id}`}>
                            Arguments
                          </label>
                          <textarea
                            id={`skill-args-${selectedSkill.id}`}
                            className="settings-textarea"
                            onChange={(event) =>
                              setSkills((current) =>
                                updateLocalSkill(current, selectedSkill.id, { argumentsText: event.target.value })
                              )
                            }
                            placeholder={"One argument per line\nproject.gpr\nscript.py"}
                            value={selectedSkill.argumentsText}
                          />
                          <div className="field-help">
                            One argument per line keeps paths with spaces safe and predictable.
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="settings-empty-state">
                        Add a skill from the left column to register local tools such as Ghidra or x64dbg.
                      </div>
                    )}
                  </section>
                ) : (
                  <section className="settings-section">
                    <div className="settings-section-headline">
                      <div>
                        <div className="settings-provider-title">GitHub Integration</div>
                        <div className="settings-provider-copy">
                          Source Control can pull live pull requests and issues for public or private GitHub repositories.
                        </div>
                      </div>
                      <span className={`state-pill ${githubRemote ? "is-done" : "is-waiting"}`}>
                        {githubRemote ? "connected remote" : "no remote"}
                      </span>
                    </div>

                    <label className="toggle-row">
                      <input
                        checked={integrations.githubAutoRefresh}
                        onChange={(event) =>
                          setIntegrations((current) => ({
                            ...current,
                            githubAutoRefresh: event.target.checked
                          }))
                        }
                        type="checkbox"
                      />
                      <span>Refresh GitHub signals automatically when the workbench opens</span>
                    </label>

                    <div className="settings-field">
                      <label className="field-label" htmlFor="github-token">
                        GitHub token
                      </label>
                      <div className="secret-row">
                        <input
                          id="github-token"
                          className="settings-input"
                          onChange={(event) =>
                            setIntegrations((current) => ({
                              ...current,
                              githubToken: event.target.value
                            }))
                          }
                          placeholder="Optional for public repositories, recommended for private repos and higher limits"
                          type={visibleSecrets["github-token"] ? "text" : "password"}
                          value={integrations.githubToken}
                        />
                        <button
                          className="secondary-button"
                          onClick={() =>
                            setVisibleSecrets((current) => ({
                              ...current,
                              "github-token": !current["github-token"]
                            }))
                          }
                          type="button"
                        >
                          {visibleSecrets["github-token"] ? "Hide" : "Show"}
                        </button>
                      </div>
                      <div className="field-help">
                        {integrations.githubToken
                          ? `Stored locally for this prototype: ${maskSecret(integrations.githubToken)}`
                          : "Leave empty for public repository signals."}
                      </div>
                    </div>

                    <div className="settings-field">
                      <label className="field-label" htmlFor="github-remote">
                        Detected remote
                      </label>
                      <input
                        id="github-remote"
                        className="settings-input"
                        readOnly
                        value={githubRemote ? githubRemote.url : "No GitHub remote detected"}
                      />
                    </div>

                    <div className="settings-inline-actions">
                      <button
                        className="secondary-button slim-button"
                        disabled={!githubRemote || githubBusy}
                        onClick={() => void handleRefreshGitHub()}
                        type="button"
                      >
                        {githubBusy ? "Refreshing..." : "Refresh GitHub"}
                      </button>
                      <button
                        className="secondary-button slim-button"
                        disabled={repositoryBusy}
                        onClick={() => void handleRefreshRepository()}
                        type="button"
                      >
                        {repositoryBusy ? "Refreshing..." : "Refresh repository"}
                      </button>
                    </div>

                    {githubError ? <div className="workflow-warning">{githubError}</div> : null}
                  </section>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}






















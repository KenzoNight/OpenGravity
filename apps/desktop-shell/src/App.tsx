import { startTransition, useEffect, useMemo, useState } from "react";

import type {
  AgentStatus,
  ModelProvider,
  ProviderHealthState,
  TaskStatus
} from "@opengravity/shared-types";

import {
  createDefaultWorkbenchSettings,
  getAvailableModelIds,
  getModelsForProvider,
  getProviderConnectionLabel,
  getProviderConnectionState,
  isProviderReady,
  maskSecret,
  normalizeWorkbenchSettings,
  serializeWorkbenchSettings,
  setActiveModel,
  settingsStorageKey,
  updateProviderProfile,
  type ProviderProfile,
  type WorkbenchSettings
} from "./settings-state";
import {
  browserFallbackHealth,
  buildDesktopShellSnapshot,
  desktopShellModels,
  type ShellHealth
} from "./shell-state";
import "./styles.css";

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

type SideView = "overview" | "handoff" | "artifacts" | "runtime";
type BottomView = "build" | "tasks" | "events" | "log";

interface ExplorerGroup {
  label: string;
  entries: string[];
}

const menuItems = ["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"];

const activityItems = [
  { id: "EX", label: "Explorer", active: true },
  { id: "AG", label: "Agents" },
  { id: "WF", label: "Workflows" },
  { id: "AR", label: "Artifacts" },
  { id: "SR", label: "Search" }
];

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

const connectionTone = (profile: ProviderProfile): string => {
  switch (getProviderConnectionState(profile)) {
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

function buildExplorerGroups(paths: string[]): ExplorerGroup[] {
  const groups = new Map<string, string[]>();

  for (const path of paths) {
    const [head, ...rest] = path.split("/");
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
  const [sideView, setSideView] = useState<SideView>("overview");
  const [bottomView, setBottomView] = useState<BottomView>("build");
  const [bottomOpen, setBottomOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [dockOpen, setDockOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ModelProvider>("anthropic");
  const [visibleSecrets, setVisibleSecrets] = useState<Partial<Record<ModelProvider, boolean>>>({});

  useEffect(() => {
    void loadShellHealth().then((nextHealth) => {
      startTransition(() => setShellHealth(nextHealth));
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(settingsStorageKey, serializeWorkbenchSettings(settings));
  }, [settings]);

  useEffect(() => {
    if (!settings.providerProfiles.some((profile) => profile.provider === selectedProvider)) {
      setSelectedProvider(settings.providerProfiles[0]?.provider ?? "anthropic");
    }
  }, [selectedProvider, settings.providerProfiles]);

  const snapshot = useMemo(() => buildDesktopShellSnapshot(shellHealth, settings), [shellHealth, settings]);
  const explorerGroups = useMemo(() => buildExplorerGroups(snapshot.workspaceFiles), [snapshot.workspaceFiles]);
  const availableModelIds = useMemo(() => new Set(getAvailableModelIds(settings, snapshot.models)), [settings, snapshot.models]);
  const activeLiveModel = useMemo(
    () => snapshot.models.find((model) => model.id === settings.activeModelId && availableModelIds.has(model.id)),
    [availableModelIds, settings.activeModelId, snapshot.models]
  );
  const readyProviders = useMemo(
    () => settings.providerProfiles.filter((profile) => isProviderReady(profile)),
    [settings.providerProfiles]
  );
  const selectedProfile = settings.providerProfiles.find((profile) => profile.provider === selectedProvider) ?? settings.providerProfiles[0];
  const selectedProviderModels = selectedProfile ? getModelsForProvider(snapshot.models, selectedProfile.provider) : [];
  const recentEvents = snapshot.sessionRecord.events.slice(-6).reverse();
  const recentArtifacts = snapshot.sessionRecord.artifacts.slice(-4).reverse();
  const runningTask = snapshot.tasks.find((task) => task.status === "running");
  const activeModelLabel = activeLiveModel?.label ?? "Setup required";

  const workbenchClassName = [
    "workbench",
    !explorerOpen && "is-explorer-collapsed",
    !dockOpen && "is-dock-collapsed"
  ]
    .filter(Boolean)
    .join(" ");

  const updateSelectedProvider = (
    patch: Partial<Omit<ProviderProfile, "provider" | "label">>
  ) => {
    if (!selectedProfile) {
      return;
    }

    setSettings((current) => updateProviderProfile(current, selectedProfile.provider, patch, snapshot.models));
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
              <span className="insight-label">Connected providers</span>
              <strong>
                {readyProviders.length} ready / {settings.providerProfiles.length} listed
              </strong>
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

  const renderBottomContent = () => {
    switch (bottomView) {
      case "build":
        return (
          <>
            <div className="bottom-panel-header">
              <span className="section-label">Execution plan</span>
              <span className="dock-chip">{snapshot.executionPlan.primaryBuildSystem ?? "inspect"}</span>
            </div>
            <div className="drawer-content">
              <div className="compact-list">
                {snapshot.executionPlan.steps.map((step) => (
                  <div className="compact-row" key={`${step.kind}-${step.label}`}>
                    <div className="compact-copy">
                      <strong>{step.label}</strong>
                      <span>{step.commands.join(" | ")}</span>
                    </div>
                    <span className="signal-pill">{step.kind}</span>
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
    }
  };

  return (
    <div className="window-shell">
      <header className="window-chrome">
        <div className="window-title">OpenGravity</div>
        <div className="window-subtitle">Hybrid Agent Operating System</div>
        <div className="window-telemetry">
          <span>{snapshot.profile.primaryLanguage?.toUpperCase() ?? "UNKNOWN"}</span>
          <span>{snapshot.executionPlan.primaryBuildSystem ?? "inspect"}</span>
          <span>{snapshot.runtimeStats.running} active</span>
          <span>{activeModelLabel}</span>
        </div>
      </header>

      <div className="menu-strip">
        <nav className="menu-items">
          {menuItems.map((item) => (
            <button className="menu-item" key={item} type="button">
              {item}
            </button>
          ))}
        </nav>

        <div className="session-path">feature/cpp-repair / wt-cpp-01 / session {snapshot.sessionId}</div>

        <div className="session-pills">
          <button
            className={`chrome-toggle ${explorerOpen ? "is-on" : ""}`}
            onClick={() => setExplorerOpen((value) => !value)}
            type="button"
          >
            Explorer
          </button>
          <button
            className={`chrome-toggle ${bottomOpen ? "is-on" : ""}`}
            onClick={() => setBottomOpen((value) => !value)}
            type="button"
          >
            Workbench
          </button>
          <button
            className={`chrome-toggle ${dockOpen ? "is-on" : ""}`}
            onClick={() => setDockOpen((value) => !value)}
            type="button"
          >
            Agent
          </button>
          <button
            className={`chrome-toggle ${settingsOpen ? "is-on" : ""}`}
            onClick={() => setSettingsOpen((value) => !value)}
            type="button"
          >
            Providers
          </button>
          <span className={`chrome-pill ${snapshot.setupRequired ? "" : "accent"}`}>
            {snapshot.setupRequired ? "Setup required" : `Active ${activeModelLabel}`}
          </span>
        </div>
      </div>

      <div className={workbenchClassName}>
        <aside className="activity-rail">
          {activityItems.map((item) => (
            <button
              className={`activity-button ${item.active ? "is-active" : ""}`}
              key={item.id}
              type="button"
              title={item.label}
            >
              <span>{item.id}</span>
            </button>
          ))}
        </aside>

        <aside className="pane explorer-pane">
          <div className="pane-header">
            <span>Explorer</span>
            <span className="pane-meta">Focused files</span>
          </div>

          <div className="pane-scroll">
            <section className="section-block">
              <div className="section-label">Open editors</div>
              <div className="flat-list">
                <div className="flat-list-row is-active">
                  <span>rigid_body_solver.cpp</span>
                </div>
                <div className="flat-list-row">
                  <span>continuity.pack</span>
                </div>
                <div className="flat-list-row">
                  <span>build.log</span>
                </div>
              </div>
            </section>

            <section className="section-block">
              <div className="section-label">Workspace</div>
              <div className="tree-root">OpenGravity</div>
              {explorerGroups.map((group) => (
                <div className="tree-group" key={group.label}>
                  <div className={`tree-item ${group.label === "root" ? "is-root-group" : "is-folder"}`}>
                    <span>{group.label === "root" ? "root" : group.label}</span>
                  </div>
                  <div className="tree-children">
                    {group.entries.map((entry) => (
                      <div className="tree-item is-file" key={`${group.label}/${entry}`}>
                        <span>{entry}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
        </aside>

        <main className="editor-column">
          <section className="editor-tabs">
            <button className="editor-tab" type="button">
              session.graph
            </button>
            <button className="editor-tab is-active" type="button">
              rigid_body_solver.cpp
            </button>
            <button className="editor-tab" type="button">
              continuity.pack
            </button>
            <button className="editor-tab" type="button">
              build.log
            </button>
          </section>

          <section className="editor-panel">
            <div className="editor-toolbar">
              <div className="breadcrumbs">src &gt; rigid_body_solver.cpp</div>
              <div className="editor-toolbar-right">
                <span className="editor-badge">builder-1</span>
                <span className={`editor-badge ${snapshot.setupRequired ? "" : "accent"}`}>{activeModelLabel}</span>
              </div>
            </div>

            <div className="editor-surface">
              {snapshot.setupRequired ? (
                <div className="setup-banner">
                  <div className="setup-copy">
                    <strong>Provider setup required</strong>
                    <p>
                      OpenGravity has already prepared the compile-repair session. Connect a provider or local
                      runtime to continue the same task with your own credentials.
                    </p>
                  </div>
                  <button className="primary-button" onClick={() => setSettingsOpen(true)} type="button">
                    Open Provider Settings
                  </button>
                </div>
              ) : null}

              <pre className="code-view">{snapshot.codeSample}</pre>
            </div>
          </section>

          <section className={`bottom-drawer ${bottomOpen ? "is-open" : "is-collapsed"}`}>
            <div className="bottom-drawer-bar">
              <div className="drawer-tabs">
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
                  <strong>OpenGravity</strong>
                  <span className={`state-pill ${taskTone(runningTask?.status ?? "queued")}`}>
                    {runningTask?.status ?? "queued"}
                  </span>
                </div>
                <p className="composer-summary">{snapshot.handoffPlan.continuityPack.currentGoal}</p>
                <div className="composer-input">
                  {snapshot.setupRequired
                    ? "Connect a provider, choose the active model, and resume the same session without resetting context."
                    : "Continue the compile-repair loop, compact context, or switch models without leaving the active session."}
                </div>
                <div className="composer-footer">
                  <span>{settings.autoHandoff ? "Auto handoff on" : "Auto handoff off"}</span>
                  <span>{activeModelLabel}</span>
                  <span>{readyProviders.length} providers ready</span>
                </div>
              </div>
            </section>

            <section className="section-block">
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
            </section>
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <span>Branch feature/cpp-repair</span>
        <span>Build {snapshot.executionPlan.primaryBuildSystem ?? "inspect"}</span>
        <span>{snapshot.failure.category}</span>
        <span>{readyProviders.length} providers ready</span>
      </footer>

      {settingsOpen && selectedProfile ? (
        <div
          className="settings-scrim"
          onClick={() => setSettingsOpen(false)}
          role="presentation"
        >
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
              <button className="secondary-button" onClick={() => setSettingsOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="settings-layout">
              <aside className="settings-sidebar">
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
                      {availableModelIds.size === 0 ? (
                        <option value="">Connect a provider first</option>
                      ) : null}
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
                          <span>{getProviderConnectionLabel(profile)}</span>
                        </div>
                        <span className={`state-pill ${connectionTone(profile)}`}>
                          {getProviderConnectionState(profile).replaceAll("-", " ")}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              </aside>

              <div className="settings-detail">
                <section className="settings-section">
                  <div className="settings-section-headline">
                    <div>
                      <div className="settings-provider-title">{selectedProfile.label}</div>
                      <div className="settings-provider-copy">{getProviderConnectionLabel(selectedProfile)}</div>
                    </div>
                    <span className={`state-pill ${connectionTone(selectedProfile)}`}>
                      {getProviderConnectionState(selectedProfile).replaceAll("-", " ")}
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

                  <div className="settings-field">
                    <label className="field-label" htmlFor={`provider-key-${selectedProfile.provider}`}>
                      {selectedProfile.provider === "ollama" ? "Runtime token" : "API key"}
                    </label>
                    <div className="secret-row">
                      <input
                        id={`provider-key-${selectedProfile.provider}`}
                        className="settings-input"
                        onChange={(event) => updateSelectedProvider({ apiKey: event.target.value })}
                        placeholder={
                          selectedProfile.provider === "ollama"
                            ? "Optional for authenticated local runtimes"
                            : `Paste your ${selectedProfile.label} API key`
                        }
                        type={visibleSecrets[selectedProfile.provider] ? "text" : "password"}
                        value={selectedProfile.apiKey}
                      />
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setVisibleSecrets((current) => ({
                            ...current,
                            [selectedProfile.provider]: !current[selectedProfile.provider]
                          }))
                        }
                        type="button"
                      >
                        {visibleSecrets[selectedProfile.provider] ? "Hide" : "Show"}
                      </button>
                    </div>
                    <div className="field-help">
                      {selectedProfile.apiKey
                        ? `Stored locally for this prototype: ${maskSecret(selectedProfile.apiKey)}`
                        : "No key stored yet."}
                    </div>
                  </div>

                  <div className="settings-field">
                    <label className="field-label" htmlFor={`provider-url-${selectedProfile.provider}`}>
                      Base URL
                    </label>
                    <input
                      id={`provider-url-${selectedProfile.provider}`}
                      className="settings-input"
                      onChange={(event) => updateSelectedProvider({ baseUrl: event.target.value })}
                      placeholder={
                        selectedProfile.provider === "ollama"
                          ? "http://127.0.0.1:11434/v1"
                          : "https://api.example.com/v1"
                      }
                      value={selectedProfile.baseUrl}
                    />
                    <div className="field-help">
                      {selectedProfile.provider === "anthropic" ||
                      selectedProfile.provider === "gemini" ||
                      selectedProfile.provider === "openai"
                        ? "Leave this blank unless you are using a proxy or compatible endpoint."
                        : "Required for OpenRouter, local runtimes, and compatible endpoints."}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

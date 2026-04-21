import {
  classifyBuildFailure,
  detectWorkspaceProfile,
  recommendWorkspaceExecution,
  type ClassifiedBuildError,
  type WorkspaceExecutionPlan
} from "@opengravity/build-intelligence";
import {
  InMemoryOrchestratorRuntime,
  getTaskCompletionStats,
  type PersistedSessionRecord,
  type ProviderHandoffPlan
} from "@opengravity/orchestrator/browser";
import { buildContinuityPack, summarizeProviderHandoff, type SessionSnapshot } from "@opengravity/session-core";
import type {
  AgentDescriptor,
  ModelDescriptor,
  ModelProvider,
  ProviderHealth,
  TaskNode,
  WorkspaceProfile
} from "@opengravity/shared-types";

import {
  createDefaultWorkbenchSettings,
  getAvailableModelIds,
  getProviderConnectionState,
  type WorkbenchSettings
} from "./settings-state";

export interface ShellHealth {
  appName: string;
  version: string;
  shell: string;
  backend: string;
  sidecarMode: string;
  features: string[];
}

export interface DesktopShellSnapshot {
  shellHealth: ShellHealth;
  sessionId: string;
  settings: WorkbenchSettings;
  setupRequired: boolean;
  workspaceFiles: string[];
  profile: WorkspaceProfile;
  executionPlan: WorkspaceExecutionPlan;
  failure: ClassifiedBuildError;
  handoffPlan: ProviderHandoffPlan;
  providerHealth: ProviderHealth[];
  models: ModelDescriptor[];
  tasks: TaskNode[];
  agents: AgentDescriptor[];
  runtimeStats: ReturnType<typeof getTaskCompletionStats>;
  sessionRecord: PersistedSessionRecord;
  buildLog: string;
  codeSample: string;
}

const sessionId = "cpp-compile-recovery";

const workspaceFiles = [
  "CMakeLists.txt",
  "CMakePresets.json",
  "src/rigid_body_solver.cpp",
  "include/physics/solver.hpp",
  "tests/solver_regression.cpp",
  "docs/architecture.md"
];

const buildLog = `
cmake -S . -B build -G Ninja
cmake --build build
cl /c src/rigid_body_solver.cpp
fatal error C1083: cannot open include file: 'physics/solver.hpp': No such file or directory
patched include directory: include
provider handoff requested: claude-4-opus quota exhausted
builder resumed on gemini-2.5-pro with continuity pack
`;

const codeSample = `#include "physics/solver.hpp"
#include "physics/workspace_context.hpp"

namespace og {

SolveResult RigidBodySolver::run(const SolveInput& input) {
    WorkspaceContext context = workspace_.restoreCheckpoint("builder:msvc-header-fix");
    BuildPlan plan = context.activePlan();
    plan.includePaths.push_back("include");
    plan.flags.push_back("/std:c++20");

    CompileResult build = toolchain_.compile(plan);
    if (!build.success) {
        return SolveResult::retryable(build.stderr);
    }

    return SolveResult::ok(build.binaryPath);
}

} // namespace og`;

export const desktopShellModels: ModelDescriptor[] = [
  {
    id: "claude-4-opus",
    label: "Claude 4 Opus",
    provider: "anthropic",
    qualityTier: "strong",
    costTier: "high",
    supportsTools: true,
    maxContextWindow: 200000
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "gemini",
    qualityTier: "strong",
    costTier: "medium",
    supportsTools: true,
    maxContextWindow: 1048576
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    provider: "openai",
    qualityTier: "strong",
    costTier: "high",
    supportsTools: true,
    maxContextWindow: 400000
  },
  {
    id: "openrouter-claude-4-sonnet",
    label: "OpenRouter Claude 4 Sonnet",
    provider: "openrouter",
    qualityTier: "strong",
    costTier: "medium",
    supportsTools: true,
    maxContextWindow: 200000
  },
  {
    id: "ollama-qwen3-coder",
    label: "Ollama Qwen3 Coder",
    provider: "ollama",
    qualityTier: "balanced",
    costTier: "low",
    supportsTools: true,
    maxContextWindow: 131072
  },
  {
    id: "custom-openai-compatible",
    label: "Custom OpenAI-Compatible",
    provider: "custom",
    qualityTier: "balanced",
    costTier: "medium",
    supportsTools: true,
    maxContextWindow: 128000
  }
];

const baseProviderHealth: ProviderHealth[] = [
  {
    provider: "anthropic",
    state: "rate_limited",
    scoreModifier: -95,
    reason: "Claude budget exhausted during compile verification."
  },
  {
    provider: "gemini",
    state: "healthy",
    scoreModifier: 16,
    reason: "Long-context capacity available for continuity handoff."
  },
  {
    provider: "openai",
    state: "degraded",
    scoreModifier: 4,
    reason: "Healthy fallback, but with less spare context headroom."
  },
  {
    provider: "openrouter",
    state: "healthy",
    scoreModifier: 10,
    reason: "OpenRouter is available as a user-managed fallback gateway."
  },
  {
    provider: "ollama",
    state: "healthy",
    scoreModifier: 8,
    reason: "Local runtime can preserve privacy for offline or low-latency work."
  },
  {
    provider: "custom",
    state: "degraded",
    scoreModifier: 2,
    reason: "Custom compatible endpoint is available when the user provides a trusted base URL."
  }
];

const baseTasks: TaskNode[] = [
  {
    id: "scan-workspace",
    title: "Profile workspace and detect toolchain",
    taskType: "review",
    requiredRole: "architect",
    dependsOn: [],
    status: "completed"
  },
  {
    id: "patch-include",
    title: "Patch solver include paths",
    taskType: "code",
    requiredRole: "coder",
    dependsOn: ["scan-workspace"],
    status: "completed"
  },
  {
    id: "compile-repair",
    title: "Re-run the MSVC compile pass",
    taskType: "build-repair",
    requiredRole: "builder",
    dependsOn: ["patch-include"],
    status: "queued"
  },
  {
    id: "rerun-ctest",
    title: "Run solver regression suite",
    taskType: "build-repair",
    requiredRole: "tester",
    dependsOn: ["compile-repair"],
    status: "queued"
  },
  {
    id: "compact-context",
    title: "Compact continuity state for future failover",
    taskType: "review",
    requiredRole: "memory",
    dependsOn: ["compile-repair"],
    status: "queued"
  },
  {
    id: "final-review",
    title: "Review the repair artifact ledger",
    taskType: "review",
    requiredRole: "reviewer",
    dependsOn: ["rerun-ctest", "compact-context"],
    status: "queued"
  }
];

const baseAgents: AgentDescriptor[] = [
  {
    id: "architect-1",
    label: "Architect",
    role: "architect",
    status: "idle",
    supportedTaskTypes: ["review"]
  },
  {
    id: "coder-1",
    label: "Coder",
    role: "coder",
    status: "idle",
    supportedTaskTypes: ["code"]
  },
  {
    id: "builder-1",
    label: "Builder",
    role: "builder",
    status: "idle",
    supportedTaskTypes: ["build-repair"]
  },
  {
    id: "tester-1",
    label: "Tester",
    role: "tester",
    status: "idle",
    supportedTaskTypes: ["build-repair"]
  },
  {
    id: "reviewer-1",
    label: "Reviewer",
    role: "reviewer",
    status: "idle",
    supportedTaskTypes: ["review"]
  },
  {
    id: "memory-1",
    label: "Memory",
    role: "memory",
    status: "idle",
    supportedTaskTypes: ["review"]
  }
];

export function buildDesktopShellSnapshot(
  shellHealth: ShellHealth,
  settings: WorkbenchSettings = createDefaultWorkbenchSettings(desktopShellModels),
  modelCatalog: ModelDescriptor[] = desktopShellModels
): DesktopShellSnapshot {
  const profile = detectWorkspaceProfile(workspaceFiles);
  const executionPlan = recommendWorkspaceExecution(profile);
  const failure = classifyBuildFailure(buildLog);
  const availableModelIds = new Set(getAvailableModelIds(settings, modelCatalog));
  const setupRequired = availableModelIds.size === 0;
  const providerHealth = resolveProviderHealth(settings, baseProviderHealth);
  const routeModels = modelCatalog.filter((model) => availableModelIds.has(model.id));
  const fallbackModels = routeModels.length > 0 ? routeModels : modelCatalog;
  const activeModelId =
    (!setupRequired && availableModelIds.has(settings.activeModelId)
      ? settings.activeModelId
      : fallbackModels[0]?.id) ??
    modelCatalog[0]?.id ??
    "";
  const activeModel = modelCatalog.find((model) => model.id === activeModelId) ?? modelCatalog[0];

  const runtime = new InMemoryOrchestratorRuntime({
    graph: baseTasks,
    agents: baseAgents
  });

  const seededSnapshot: SessionSnapshot = {
    title: "C++ Compile Recovery",
    currentGoal: setupRequired
      ? "Connect a provider, choose an active model, and resume the paused compile-repair loop."
      : "Recover the failed MSVC build, rerun CTest, and preserve the same task state across model handoff.",
    executiveSummary: setupRequired
      ? "OpenGravity already classified the compile failure and prepared the continuity state, but live execution is paused until the user configures at least one provider or local runtime."
      : "Claude fixed the include path, but the provider budget expired before compile verification finished. OpenGravity must continue the same repair loop on a different strong model without asking the user to restate context.",
    activeModelId,
    fallbackTrail: [activeModelId],
    branch: "feature/cpp-repair",
    worktree: "wt-cpp-01",
    openBlockers: setupRequired
      ? ["No enabled provider with a valid API key or local runtime is configured."]
      : ["Anthropic quota exhausted before compile verification could finish."],
    pendingActions: setupRequired
      ? [
          "open Provider Settings",
          "enable a provider or local runtime",
          "enter the required API key or base URL",
          "resume compile verification"
        ]
      : [
          "rerun cmake --build build",
          "rerun ctest --test-dir build --output-on-failure",
          "record final review artifact"
        ],
    changedFiles: [
      {
        path: "src/rigid_body_solver.cpp",
        summary: "Patched solver header resolution and restored the build checkpoint flow."
      }
    ],
    latestLogs: setupRequired
      ? [
          "fatal error C1083: cannot open include file: 'physics/solver.hpp'",
          "patched include directory: include",
          "live execution paused until a provider is configured"
        ]
      : [
          "fatal error C1083: cannot open include file: 'physics/solver.hpp'",
          "patched include directory: include",
          `${activeModelId} quota exhausted during compile verification`
        ]
  };

  runtime.seedSession(sessionId, seededSnapshot);

  runtime.recordArtifact({
    kind: "plan",
    title: "Repair Plan",
    contentSummary: "Patch solver include paths, re-run the CMake build, then validate with CTest."
  });
  runtime.recordArtifact({
    kind: "build-log",
    title: "MSVC Include Failure",
    contentSummary: "Captured the original C1083 include failure and the handoff trigger line.",
    taskId: "compile-repair"
  });

  let handoffPlan: ProviderHandoffPlan;

  if (setupRequired) {
    runtime.recordArtifact({
      kind: "plan",
      title: "Provider Setup Checklist",
      contentSummary: "Enable a provider, add an API key or local runtime, select the active model, then resume."
    });
    runtime.transitionTask(
      "compile-repair",
      "blocked",
      "Connect a provider in Settings to continue compile verification."
    );

    const continuityPack = buildContinuityPack(seededSnapshot);
    handoffPlan = {
      nextModel: activeModel,
      continuityPack,
      continuitySummary: summarizeProviderHandoff(continuityPack),
      score: 0,
      reasons: ["setup-required"]
    };
  } else {
    runtime.dispatchNextTasks();
    runtime.transitionTask(
      "compile-repair",
      "blocked",
      "Claude 4 Opus quota exhausted during post-patch compile verification."
    );

    handoffPlan = runtime.planHandoff({
      sessionId,
      request: {
        taskType: "build-repair",
        activeModelId,
        excludedModelIds: [activeModelId],
        needsLongContext: true,
        requiresStrongReasoning: true
      },
      models: fallbackModels,
      providerHealth
    });

    runtime.transitionTask("compile-repair", "ready");
    runtime.dispatchNextTasks();
    runtime.recordArtifact({
      kind: "task-snapshot",
      title: "Compile Retry Snapshot",
      contentSummary: `Builder resumed compile-repair on ${handoffPlan.nextModel.label} using the continuity pack.`,
      taskId: "compile-repair"
    });
  }

  const runtimeSnapshot = runtime.getSnapshot();
  const sessionRecord = runtime.getSessionRecord(sessionId);
  if (!sessionRecord) {
    throw new Error("Expected an active session record for the desktop shell snapshot.");
  }

  return {
    shellHealth,
    sessionId,
    settings,
    setupRequired,
    workspaceFiles,
    profile,
    executionPlan,
    failure,
    handoffPlan,
    providerHealth,
    models: modelCatalog,
    tasks: runtimeSnapshot.graph.tasks,
    agents: runtimeSnapshot.registry.agents,
    runtimeStats: getTaskCompletionStats(runtimeSnapshot.graph),
    sessionRecord,
    buildLog: buildLog.trim(),
    codeSample
  };
}

function resolveProviderHealth(
  settings: WorkbenchSettings,
  providerHealth: ProviderHealth[]
): ProviderHealth[] {
  const profileMap = new Map(settings.providerProfiles.map((profile) => [profile.provider, profile]));

  return providerHealth.map((entry) => {
    const profile = profileMap.get(entry.provider);
    if (!profile) {
      return {
        ...entry,
        state: "offline",
        scoreModifier: -100,
        reason: "Provider is not configured for this workspace."
      };
    }

    const connectionState = getProviderConnectionState(profile);
    if (connectionState !== "ready") {
      const reason =
        connectionState === "disabled"
          ? `${profile.label} is disabled in local settings.`
          : connectionState === "missing-base-url"
            ? `${profile.label} is enabled but missing a base URL.`
            : `${profile.label} is enabled but missing an API key.`;

      return {
        ...entry,
        state: "offline",
        scoreModifier: -100,
        reason
      };
    }

    return entry;
  });
}

export const browserFallbackHealth: ShellHealth = {
  appName: "OpenGravity",
  version: "0.1.0",
  shell: "browser-preview",
  backend: "mock",
  sidecarMode: "planned-cpp-sidecars",
  features: [
    "Tauri hybrid shell",
    "Browser-safe orchestrator core",
    "Continuity packs",
    "Polyglot build intelligence",
    "Multi-agent task graph"
  ]
};

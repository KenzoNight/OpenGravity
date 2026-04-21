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
import type {
  AgentDescriptor,
  ModelDescriptor,
  ProviderHealth,
  TaskNode,
  WorkspaceProfile
} from "@opengravity/shared-types";

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

const models: ModelDescriptor[] = [
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
  }
];

const providerHealth: ProviderHealth[] = [
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

export function buildDesktopShellSnapshot(shellHealth: ShellHealth): DesktopShellSnapshot {
  const profile = detectWorkspaceProfile(workspaceFiles);
  const executionPlan = recommendWorkspaceExecution(profile);
  const failure = classifyBuildFailure(buildLog);

  const runtime = new InMemoryOrchestratorRuntime({
    graph: baseTasks,
    agents: baseAgents
  });

  runtime.seedSession(sessionId, {
    title: "C++ Compile Recovery",
    currentGoal: "Recover the failed MSVC build, rerun CTest, and preserve the same task state across model handoff.",
    executiveSummary:
      "Claude fixed the include path, but the provider budget expired before compile verification finished. OpenGravity must continue the same repair loop on a different strong model without asking the user to restate context.",
    activeModelId: "claude-4-opus",
    fallbackTrail: ["claude-4-opus"],
    branch: "feature/cpp-repair",
    worktree: "wt-cpp-01",
    openBlockers: ["Anthropic quota exhausted before compile verification could finish."],
    pendingActions: [
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
    latestLogs: [
      "fatal error C1083: cannot open include file: 'physics/solver.hpp'",
      "patched include directory: include",
      "claude-4-opus quota exhausted during compile verification"
    ]
  });

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

  runtime.dispatchNextTasks();
  runtime.transitionTask(
    "compile-repair",
    "blocked",
    "Claude 4 Opus quota exhausted during post-patch compile verification."
  );

  const handoffPlan = runtime.planHandoff({
    sessionId,
    request: {
      taskType: "build-repair",
      activeModelId: "claude-4-opus",
      excludedModelIds: ["claude-4-opus"],
      needsLongContext: true,
      requiresStrongReasoning: true
    },
    models,
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

  const runtimeSnapshot = runtime.getSnapshot();
  const sessionRecord = runtime.getSessionRecord(sessionId);
  if (!sessionRecord) {
    throw new Error("Expected an active session record for the desktop shell snapshot.");
  }

  return {
    shellHealth,
    sessionId,
    workspaceFiles,
    profile,
    executionPlan,
    failure,
    handoffPlan,
    providerHealth,
    models,
    tasks: runtimeSnapshot.graph.tasks,
    agents: runtimeSnapshot.registry.agents,
    runtimeStats: getTaskCompletionStats(runtimeSnapshot.graph),
    sessionRecord,
    buildLog: buildLog.trim(),
    codeSample
  };
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

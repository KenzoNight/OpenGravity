import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentDescriptor, ModelDescriptor, ProviderHealth, TaskNode } from "@opengravity/shared-types";

import {
  InMemoryContinuityStore,
  allocateAgent,
  buildRoutingCandidates,
  createAgentRegistry,
  createTaskGraph,
  getRunnableTasks,
  planProviderHandoff,
  releaseAgent,
  updateTaskStatus
} from "./index.js";

const makeTask = (overrides: Partial<TaskNode>): TaskNode => ({
  id: "task",
  title: "Task",
  taskType: "code",
  requiredRole: "coder",
  dependsOn: [],
  status: "queued",
  ...overrides
});

const makeAgent = (overrides: Partial<AgentDescriptor>): AgentDescriptor => ({
  id: "agent",
  label: "Agent",
  role: "coder",
  status: "idle",
  supportedTaskTypes: ["code"],
  ...overrides
});

const makeModel = (overrides: Partial<ModelDescriptor>): ModelDescriptor => ({
  id: "model",
  label: "Model",
  provider: "custom",
  qualityTier: "balanced",
  costTier: "medium",
  supportsTools: true,
  maxContextWindow: 128000,
  ...overrides
});

describe("orchestrator task graph", () => {
  it("returns runnable tasks only after dependencies complete", () => {
    const graph = createTaskGraph([
      makeTask({ id: "plan", taskType: "review", requiredRole: "architect", status: "completed" }),
      makeTask({ id: "build", taskType: "build-repair", requiredRole: "builder", dependsOn: ["plan"] }),
      makeTask({ id: "review", taskType: "review", requiredRole: "reviewer", dependsOn: ["build"] })
    ]);

    const runnable = getRunnableTasks(graph);
    assert.deepEqual(runnable.map((task) => task.id), ["build"]);

    const updated = updateTaskStatus(graph, "build", "completed");
    const nextRunnable = getRunnableTasks(updated);
    assert.deepEqual(nextRunnable.map((task) => task.id), ["review"]);
  });

  it("rejects cyclic task graphs", () => {
    assert.throws(
      () =>
        createTaskGraph([
          makeTask({ id: "a", dependsOn: ["b"] }),
          makeTask({ id: "b", dependsOn: ["a"] })
        ]),
      /Cycle detected/
    );
  });
});

describe("orchestrator agent registry", () => {
  it("allocates and releases agents cleanly", () => {
    const registry = createAgentRegistry([
      makeAgent({ id: "builder-1", role: "builder", supportedTaskTypes: ["build-repair"] }),
      makeAgent({ id: "coder-1", role: "coder" })
    ]);

    const allocation = allocateAgent(registry, "builder", "compile-pass");
    assert.equal(allocation.agent.id, "builder-1");
    assert.equal(allocation.agent.assignedTaskId, "compile-pass");

    const released = releaseAgent(allocation.registry, "builder-1");
    const builder = released.agents.find((agent) => agent.id === "builder-1");
    assert.equal(builder?.status, "idle");
    assert.equal(builder?.assignedTaskId, undefined);
  });
});

describe("orchestrator continuity handoff", () => {
  it("plans a provider handoff using continuity state and provider health", () => {
    const store = new InMemoryContinuityStore();
    store.save("session-1", {
      title: "C++ compile repair",
      currentGoal: "Recover the failed MSVC build",
      executiveSummary: "Resume after provider failover without losing context",
      activeModelId: "claude-4-opus",
      fallbackTrail: ["claude-4-opus"],
      branch: "feature/cpp-fix",
      worktree: "wt-cpp-01",
      openBlockers: ["Need rerun after include patch"],
      pendingActions: ["rerun cmake", "rerun ctest"],
      changedFiles: [{ path: "src/solver.cpp", summary: "Adjusted include path handling" }],
      latestLogs: ["C1083 include failure", "Patch applied"]
    });

    const models: ModelDescriptor[] = [
      makeModel({
        id: "claude-4-opus",
        label: "Claude 4 Opus",
        provider: "anthropic",
        qualityTier: "strong",
        maxContextWindow: 200000
      }),
      makeModel({
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        provider: "gemini",
        qualityTier: "strong",
        maxContextWindow: 1048576
      })
    ];

    const providerHealth: ProviderHealth[] = [
      { provider: "anthropic", state: "rate_limited", scoreModifier: -80, reason: "Quota exhausted" },
      { provider: "gemini", state: "healthy", scoreModifier: 12 }
    ];

    const plan = planProviderHandoff({
      sessionId: "session-1",
      continuityStore: store,
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

    assert.equal(plan.nextModel.id, "gemini-2.5-pro");
    assert.ok(plan.continuitySummary.includes("Recover the failed MSVC build"));
    assert.ok(plan.continuityPack.fallbackTrail.includes("gemini-2.5-pro"));
    assert.deepEqual(plan.continuityPack.pendingActions, ["rerun cmake", "rerun ctest"]);
  });

  it("converts provider health into routing candidates", () => {
    const candidates = buildRoutingCandidates(
      [
        makeModel({ id: "a", provider: "anthropic" }),
        makeModel({ id: "b", provider: "gemini" })
      ],
      [
        { provider: "anthropic", state: "offline", scoreModifier: -100 },
        { provider: "gemini", state: "degraded", scoreModifier: -10 }
      ]
    );

    const anthropic = candidates.find((candidate) => candidate.model.id === "a");
    const gemini = candidates.find((candidate) => candidate.model.id === "b");

    assert.equal(anthropic?.available, false);
    assert.equal(gemini?.available, true);
    assert.equal(gemini?.healthScore, 60);
  });
});

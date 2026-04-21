import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentDescriptor, ModelDescriptor, ProviderHealth, TaskNode } from "@opengravity/shared-types";

import { InMemoryOrchestratorRuntime } from "./runtime.js";

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
  supportedTaskTypes: ["code", "review", "build-repair"],
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

describe("InMemoryOrchestratorRuntime", () => {
  it("dispatches tasks in dependency order and releases agents after completion", () => {
    const runtime = new InMemoryOrchestratorRuntime({
      graph: [
        makeTask({ id: "plan", taskType: "review", requiredRole: "architect", status: "completed" }),
        makeTask({ id: "build", taskType: "build-repair", requiredRole: "builder", dependsOn: ["plan"] }),
        makeTask({ id: "review", taskType: "review", requiredRole: "reviewer", dependsOn: ["build"] })
      ],
      agents: [
        makeAgent({ id: "architect-1", role: "architect", supportedTaskTypes: ["review"] }),
        makeAgent({ id: "builder-1", role: "builder", supportedTaskTypes: ["build-repair"] }),
        makeAgent({ id: "reviewer-1", role: "reviewer", supportedTaskTypes: ["review"] })
      ]
    });
    runtime.seedSession("runtime-1", {
      title: "Dispatch Order",
      currentGoal: "Run tasks in order",
      executiveSummary: "Track runtime event history",
      activeModelId: "claude-4-opus",
      fallbackTrail: ["claude-4-opus"],
      openBlockers: [],
      pendingActions: ["run build", "run review"],
      changedFiles: [],
      latestLogs: []
    });

    const firstDispatch = runtime.dispatchNextTasks();
    assert.deepEqual(firstDispatch, [{ taskId: "build", agentId: "builder-1" }]);

    runtime.transitionTask("build", "completed");
    const secondDispatch = runtime.dispatchNextTasks();
    assert.deepEqual(secondDispatch, [{ taskId: "review", agentId: "reviewer-1" }]);

    const snapshot = runtime.getSnapshot();
    const builder = snapshot.registry.agents.find((agent) => agent.id === "builder-1");
    const reviewTask = snapshot.graph.tasks.find((task) => task.id === "review");
    const record = runtime.getSessionRecord("runtime-1");

    assert.equal(builder?.status, "idle");
    assert.equal(reviewTask?.status, "running");
    assert.ok(record);
    assert.ok((record?.events.length ?? 0) >= 5);
  });

  it("keeps blocked reason and frees the assigned agent", () => {
    const runtime = new InMemoryOrchestratorRuntime({
      graph: [makeTask({ id: "compile", taskType: "build-repair", requiredRole: "builder" })],
      agents: [makeAgent({ id: "builder-1", role: "builder", supportedTaskTypes: ["build-repair"] })]
    });
    runtime.seedSession("runtime-2", {
      title: "Blocked Build",
      currentGoal: "Capture blocker",
      executiveSummary: "Persist blocked state",
      activeModelId: "claude-4-opus",
      fallbackTrail: ["claude-4-opus"],
      openBlockers: [],
      pendingActions: ["detect toolchain"],
      changedFiles: [],
      latestLogs: []
    });

    runtime.dispatchNextTasks();
    runtime.transitionTask("compile", "blocked", "Missing MSVC toolchain");

    const snapshot = runtime.getSnapshot();
    const task = snapshot.graph.tasks[0];
    const agent = snapshot.registry.agents[0];

    assert.equal(task.status, "blocked");
    assert.equal(task.blockerReason, "Missing MSVC toolchain");
    assert.equal(agent.status, "idle");
    assert.ok(runtime.getSessionRecord("runtime-2")?.events.some((event) => event.type === "task_transitioned"));
  });

  it("plans a handoff through the runtime continuity store", () => {
    const runtime = new InMemoryOrchestratorRuntime({
      graph: [makeTask({ id: "compile", taskType: "build-repair", requiredRole: "builder" })],
      agents: [makeAgent({ id: "builder-1", role: "builder", supportedTaskTypes: ["build-repair"] })]
    });

    runtime.seedSession("sess-1", {
      title: "Compile recovery",
      currentGoal: "Continue the same build task",
      executiveSummary: "Switch providers without restating context",
      activeModelId: "claude-4-opus",
      fallbackTrail: ["claude-4-opus"],
      openBlockers: ["Need rerun after patch"],
      pendingActions: ["rerun cmake"],
      changedFiles: [{ path: "src/main.cpp", summary: "Patched include handling" }],
      latestLogs: ["C1083", "patched include"]
    });

    const models: ModelDescriptor[] = [
      makeModel({
        id: "claude-4-opus",
        provider: "anthropic",
        qualityTier: "strong",
        maxContextWindow: 200000
      }),
      makeModel({
        id: "gemini-2.5-pro",
        provider: "gemini",
        qualityTier: "strong",
        maxContextWindow: 1048576
      })
    ];

    const providerHealth: ProviderHealth[] = [
      { provider: "anthropic", state: "rate_limited", scoreModifier: -90 },
      { provider: "gemini", state: "healthy", scoreModifier: 12 }
    ];

    const plan = runtime.planHandoff({
      sessionId: "sess-1",
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
    assert.ok(plan.continuityPack.fallbackTrail.includes("gemini-2.5-pro"));
    assert.ok(plan.continuitySummary.includes("Continue the same build task"));
    assert.equal(runtime.getSessionRecord("sess-1")?.artifacts[0]?.kind, "continuity-pack");
  });

  it("records artifacts against the active session", () => {
    const runtime = new InMemoryOrchestratorRuntime({
      graph: [makeTask({ id: "review", taskType: "review", requiredRole: "reviewer" })],
      agents: [makeAgent({ id: "reviewer-1", role: "reviewer", supportedTaskTypes: ["review"] })]
    });

    runtime.seedSession("sess-2", {
      title: "Artifact Session",
      currentGoal: "Record outputs",
      executiveSummary: "Track artifacts in ledger",
      activeModelId: "gpt-5",
      fallbackTrail: ["gpt-5"],
      openBlockers: [],
      pendingActions: [],
      changedFiles: [],
      latestLogs: []
    });

    const artifact = runtime.recordArtifact({
      kind: "review-note",
      title: "Patch Review",
      contentSummary: "Flagged a possible null edge case",
      taskId: "review"
    });

    const record = runtime.getSessionRecord("sess-2");
    assert.equal(artifact.kind, "review-note");
    assert.equal(record?.artifacts.length, 1);
    assert.equal(record?.events.at(-1)?.type, "artifact_recorded");
  });
});

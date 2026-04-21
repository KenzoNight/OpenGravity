import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WorkspaceExecutionPlan } from "@opengravity/build-intelligence";

import { applyWorkflowCommandResult, applyWorkflowEvent, cancelWorkflowRun, createWorkflowRun, getNextQueuedWorkflowItem, getWorkflowProgress, markWorkflowItemRunning } from "./workflow-state.js";

const samplePlan: WorkspaceExecutionPlan = {
  primaryBuildSystem: "cmake",
  rationale: [],
  steps: [
    {
      kind: "configure",
      label: "Configure",
      commands: ["cmake -S . -B build"],
      rationale: "configure"
    },
    {
      kind: "test",
      label: "Run tests",
      commands: ["ctest --test-dir build --output-on-failure"],
      rationale: "test"
    }
  ]
};

describe("workflow-state", () => {
  it("creates a queue from the execution plan", () => {
    const run = createWorkflowRun(samplePlan);

    assert.equal(run.items.length, 2);
    assert.equal(run.status, "running");
    assert.equal(getNextQueuedWorkflowItem(run)?.command, "cmake -S . -B build");
  });

  it("tracks completion and failure from command results", () => {
    const created = createWorkflowRun(samplePlan);
    const running = markWorkflowItemRunning(created, created.items[0]!.id, "cmd-1");
    const completed = applyWorkflowCommandResult(running, created.items[0]!.id, {
      command: "cmake -S . -B build",
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 120
    });
    const failedRunning = markWorkflowItemRunning(completed, completed.items[1]!.id, "cmd-2");
    const failed = applyWorkflowCommandResult(failedRunning, completed.items[1]!.id, {
      command: "ctest --test-dir build --output-on-failure",
      success: false,
      exitCode: 8,
      stdout: "",
      stderr: "failure",
      durationMs: 450
    });

    assert.equal(getWorkflowProgress(completed).completed, 1);
    assert.equal(completed.status, "running");
    assert.equal(failed.status, "failed");
    assert.equal(failed.items[1]!.status, "failed");
  });

  it("applies event-driven completion and cancellation", () => {
    const created = createWorkflowRun(samplePlan);
    const running = markWorkflowItemRunning(created, created.items[0]!.id, "cmd-1");
    const completed = applyWorkflowEvent(running, {
      runId: "cmd-1",
      command: "cmake -S . -B build",
      kind: "completed",
      success: true,
      exitCode: 0,
      durationMs: 300
    });
    const cancelled = cancelWorkflowRun(markWorkflowItemRunning(completed, completed.items[1]!.id, "cmd-2"));
    const cancelledResolved = applyWorkflowEvent(cancelled, {
      runId: "cmd-2",
      command: "ctest --test-dir build --output-on-failure",
      kind: "cancelled",
      success: false,
      exitCode: -1,
      durationMs: 100
    });

    assert.equal(completed.items[0]!.status, "completed");
    assert.equal(cancelledResolved.status, "cancelled");
    assert.equal(cancelledResolved.items[1]!.status, "cancelled");
  });
});

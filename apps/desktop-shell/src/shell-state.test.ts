import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { browserFallbackHealth, buildDesktopShellSnapshot } from "./shell-state.js";

describe("buildDesktopShellSnapshot", () => {
  it("builds a C++ handoff session with the expected execution profile", () => {
    const snapshot = buildDesktopShellSnapshot(browserFallbackHealth);

    assert.equal(snapshot.profile.primaryLanguage, "cpp");
    assert.equal(snapshot.executionPlan.primaryBuildSystem, "cmake");
    assert.equal(snapshot.failure.category, "missing-header");
    assert.equal(snapshot.handoffPlan.nextModel.id, "gemini-2.5-pro");
    assert.ok(snapshot.handoffPlan.continuityPack.fallbackTrail.includes("gemini-2.5-pro"));
  });

  it("keeps runtime state, events, and artifacts aligned after the handoff", () => {
    const snapshot = buildDesktopShellSnapshot(browserFallbackHealth);
    const compileTask = snapshot.tasks.find((task) => task.id === "compile-repair");
    const builder = snapshot.agents.find((agent) => agent.id === "builder-1");

    assert.equal(snapshot.runtimeStats.running, 1);
    assert.equal(compileTask?.status, "running");
    assert.equal(builder?.status, "busy");
    assert.ok(snapshot.sessionRecord.events.some((event) => event.type === "provider_handoff_planned"));
    assert.ok(snapshot.sessionRecord.artifacts.some((artifact) => artifact.kind === "continuity-pack"));
    assert.ok(snapshot.sessionRecord.artifacts.some((artifact) => artifact.kind === "task-snapshot"));
  });
});

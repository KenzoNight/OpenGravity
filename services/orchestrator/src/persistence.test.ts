import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { InMemorySessionStore, JsonFileSessionStore } from "./index.js";

describe("session ledger stores", () => {
  it("captures snapshots, events, and artifacts in memory", () => {
    const store = new InMemorySessionStore();

    store.save("session-a", {
      title: "Compile Recovery",
      currentGoal: "Continue build task",
      executiveSummary: "Keep continuity after rate limits",
      activeModelId: "claude-4-opus",
      fallbackTrail: ["claude-4-opus"],
      openBlockers: ["Need rerun"],
      pendingActions: ["rerun cmake"],
      changedFiles: [],
      latestLogs: ["C1083"]
    });

    store.appendEvent("session-a", {
      type: "task_transitioned",
      message: "Task compile transitioned to blocked."
    });

    store.addArtifact("session-a", {
      kind: "build-log",
      title: "Build Failure Log",
      contentSummary: "Captured MSVC include failure"
    });

    const record = store.getRecord("session-a");
    assert.ok(record);
    assert.equal(record?.snapshot?.currentGoal, "Continue build task");
    assert.equal(record?.events.length, 1);
    assert.equal(record?.artifacts.length, 1);
  });

  it("persists session records to json files and reloads them", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "opengravity-store-"));

    {
      const store = new JsonFileSessionStore(baseDir);
      store.save("session-b", {
        title: "Provider Handoff",
        currentGoal: "Switch to Gemini",
        executiveSummary: "Persisted handoff",
        activeModelId: "gemini-2.5-pro",
        fallbackTrail: ["claude-4-opus", "gemini-2.5-pro"],
        openBlockers: [],
        pendingActions: ["resume task"],
        changedFiles: [],
        latestLogs: ["handoff ready"]
      });
      store.appendEvent("session-b", {
        type: "provider_handoff_planned",
        message: "Planned handoff to Gemini."
      });
      store.addArtifact("session-b", {
        kind: "continuity-pack",
        title: "Continuity Pack",
        contentSummary: "Switch plan prepared"
      });
    }

    const reloaded = new JsonFileSessionStore(baseDir);
    const record = reloaded.getRecord("session-b");
    assert.ok(record);
    assert.equal(record?.snapshot?.activeModelId, "gemini-2.5-pro");
    assert.equal(record?.events.length, 1);
    assert.equal(record?.artifacts[0]?.kind, "continuity-pack");
  });
});

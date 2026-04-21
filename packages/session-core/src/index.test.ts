import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildContinuityPack, summarizeProviderHandoff } from "./index.js";

describe("buildContinuityPack", () => {
  it("deduplicates state and trims noisy logs", () => {
    const pack = buildContinuityPack({
      title: " C++ Recovery ",
      currentGoal: " Fix the MSVC include path ",
      executiveSummary: " Resume the same task after a provider failover. ",
      activeModelId: "gemini-2.5-pro",
      fallbackTrail: ["claude-4-opus", "Gemini-2.5-Pro", "claude-4-opus"],
      branch: " feature/build-repair ",
      worktree: " wt-01 ",
      openBlockers: ["Missing include path", "missing include path", "Pending regression run"],
      pendingActions: ["rerun cmake", "Rerun CMake", "run ctest"],
      changedFiles: [
        { path: "src/solver.cpp", summary: "Adjusted include lookup order" },
        { path: " ", summary: "ignored" }
      ],
      latestLogs: ["", "configure ok", "compile failed", "patched include", "compile passed", "ctest passed", "done"]
    });

    assert.equal(pack.title, "C++ Recovery");
    assert.equal(pack.branch, "feature/build-repair");
    assert.equal(pack.worktree, "wt-01");
    assert.deepEqual(pack.openBlockers, ["Missing include path", "Pending regression run"]);
    assert.deepEqual(pack.pendingActions, ["rerun cmake", "run ctest"]);
    assert.equal(pack.changedFiles.length, 1);
    assert.deepEqual(pack.latestLogs, ["compile failed", "patched include", "compile passed", "ctest passed", "done"]);
  });

  it("creates a compact provider handoff summary", () => {
    const summary = summarizeProviderHandoff(
      buildContinuityPack({
        title: "Router",
        currentGoal: "Continue the same build task",
        executiveSummary: "Switch models cleanly",
        activeModelId: "gemini-2.5-pro",
        fallbackTrail: ["claude-4-opus", "gemini-2.5-pro"],
        openBlockers: ["Need fresh configure"],
        pendingActions: ["rerun cmake", "rerun ctest"],
        changedFiles: [],
        latestLogs: []
      })
    );

    assert.match(summary, /Continue the same build task/);
    assert.match(summary, /claude-4-opus -> gemini-2.5-pro/);
    assert.match(summary, /rerun cmake/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendTerminalSession,
  applyWorkspaceCommandEvent,
  buildTerminalTranscript,
  createTerminalSession,
  createTerminalSessionFromResult,
  formatCommandSummary,
  resolveSelectedTerminalRunId
} from "./terminal-state.js";

describe("terminal-state", () => {
  it("builds sessions from started and completed command results", () => {
    const running = createTerminalSession({
      runId: "run-1",
      command: "npm run test"
    });
    const completed = createTerminalSessionFromResult({
      command: "npm run typecheck",
      success: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 420
    });

    assert.equal(running.status, "running");
    assert.equal(completed.status, "completed");
    assert.match(completed.runId, /^fallback-/);
    assert.equal(formatCommandSummary(completed), "Exit 0 · 420 ms");
  });

  it("applies streaming workspace events to the matching session", () => {
    const sessions = [
      createTerminalSession({
        runId: "run-1",
        command: "cmake --build build"
      })
    ];

    const withStdout = applyWorkspaceCommandEvent(sessions, {
      runId: "run-1",
      command: "cmake --build build",
      kind: "stdout",
      line: "Compiling solver.cpp"
    });
    const finished = applyWorkspaceCommandEvent(withStdout, {
      runId: "run-1",
      command: "cmake --build build",
      kind: "completed",
      success: false,
      exitCode: 2,
      durationMs: 891,
      message: "Build failed"
    });

    assert.equal(finished[0]?.stdout, "Compiling solver.cpp");
    assert.equal(finished[0]?.status, "failed");
    assert.equal(finished[0]?.message, "Build failed");
  });

  it("resolves the selected terminal session and formats transcript output", () => {
    const sessionA = createTerminalSession({
      runId: "run-a",
      command: "npm run typecheck"
    });
    const sessionB = createTerminalSessionFromResult({
      command: "npm run test",
      success: false,
      exitCode: 1,
      stdout: "1 passed",
      stderr: "1 failed",
      durationMs: 500
    });
    const sessions = appendTerminalSession([sessionA], sessionB);

    assert.equal(resolveSelectedTerminalRunId(sessions, null, null), sessionB.runId);
    assert.equal(resolveSelectedTerminalRunId(sessions, sessionA.runId, null), sessionA.runId);

    const transcript = buildTerminalTranscript({
      ...sessionB,
      message: "Test failure"
    });

    assert.match(transcript, /\$ npm run test/);
    assert.match(transcript, /\[status\] Test failure/);
    assert.match(transcript, /\[stderr\]/);
    assert.match(transcript, /1 failed/);
  });
});

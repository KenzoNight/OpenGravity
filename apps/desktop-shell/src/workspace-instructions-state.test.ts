import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorkspaceInstructionsPrompt,
  getWorkspaceInstructionsStatus,
  normalizeWorkspaceInstructions
} from "./workspace-instructions-state.js";

describe("workspace-instructions-state", () => {
  it("normalizes AGENTS instructions only when both path and content exist", () => {
    assert.equal(normalizeWorkspaceInstructions("", "rules"), null);
    assert.equal(normalizeWorkspaceInstructions("AGENTS.md", ""), null);

    const normalized = normalizeWorkspaceInstructions("AGENTS.md", "Use rg before grep.");

    assert.deepEqual(normalized, {
      path: "AGENTS.md",
      content: "Use rg before grep."
    });
  });

  it("builds a prompt section and trims oversized instruction files", () => {
    const oversized = `${"a".repeat(6100)}\nend`;
    const normalized = normalizeWorkspaceInstructions("AGENTS.md", oversized);
    const prompt = buildWorkspaceInstructionsPrompt(normalized);

    assert.ok(normalized);
    assert.ok(prompt);
    assert.match(prompt ?? "", /^Workspace instructions from AGENTS\.md:/);
    assert.match(prompt ?? "", /\.\.\.$/);
    assert.equal(getWorkspaceInstructionsStatus(normalized), "AGENTS.md loaded");
    assert.equal(getWorkspaceInstructionsStatus(null), "No workspace instructions loaded");
  });
});

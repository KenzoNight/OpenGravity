import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDefaultWorkbenchUiState,
  normalizeWorkbenchUiState,
  serializeWorkbenchUiState
} from "./workbench-ui-state.js";

describe("workbench-ui-state", () => {
  it("creates a user-friendly default desktop layout", () => {
    const state = createDefaultWorkbenchUiState();

    assert.equal(state.primaryView, "explorer");
    assert.equal(state.selectedProvider, "gemini");
    assert.equal(state.bottomOpen, false);
  });

  it("normalizes persisted layout preferences safely", () => {
    const state = normalizeWorkbenchUiState({
      activityBarOpen: false,
      agentDetailsOpen: true,
      bottomOpen: true,
      bottomView: "build",
      dockOpen: false,
      explorerOpen: false,
      primaryView: "agents",
      selectedProvider: "groq",
      settingsView: "skills",
      sideView: "runtime",
      statusBarOpen: false
    });

    assert.equal(state.selectedProvider, "groq");
    assert.equal(state.bottomView, "build");
    assert.equal(state.statusBarOpen, false);
    assert.deepEqual(JSON.parse(serializeWorkbenchUiState(state)).selectedProvider, "groq");
  });
});

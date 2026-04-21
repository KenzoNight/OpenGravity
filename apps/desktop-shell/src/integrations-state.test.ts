import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDefaultIntegrationSettings,
  normalizeIntegrationSettings,
  serializeIntegrationSettings
} from "./integrations-state.js";

describe("integrations-state", () => {
  it("creates default GitHub integration settings", () => {
    assert.deepEqual(createDefaultIntegrationSettings(), {
      githubToken: "",
      githubAutoRefresh: true
    });
  });

  it("normalizes partial integration settings safely", () => {
    assert.deepEqual(
      normalizeIntegrationSettings({
        githubToken: " ghp_test_1234 ",
        githubAutoRefresh: false
      }),
      {
        githubToken: "ghp_test_1234",
        githubAutoRefresh: false
      }
    );
  });

  it("serializes integration settings", () => {
    assert.equal(
      serializeIntegrationSettings({
        githubToken: "",
        githubAutoRefresh: true
      }),
      JSON.stringify({
        githubToken: "",
        githubAutoRefresh: true
      })
    );
  });
});

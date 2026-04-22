import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDefaultPermissionSettings,
  evaluateAgentActionPermission,
  evaluatePermission,
  getPermissionDecisionLabel,
  getPermissionProfileDescription,
  getPermissionProfileLabel,
  getPermissionSettingsStorageKey,
  normalizePermissionSettings
} from "./permission-state.js";

describe("permission-state", () => {
  it("allows open file actions in every profile", () => {
    const action = {
      id: "open-1",
      label: "Open CMakeLists.txt",
      path: "CMakeLists.txt",
      type: "open_file" as const
    };

    for (const profile of ["cautious", "balanced", "auto-safe"] as const) {
      assert.equal(evaluateAgentActionPermission(action, { profile }), "allow");
    }
  });

  it("allows safe build commands in balanced mode but not in cautious mode", () => {
    assert.equal(evaluatePermission("run_command", "npm run test", { profile: "cautious" }), "ask");
    assert.equal(evaluatePermission("run_command", "npm run test", { profile: "balanced" }), "allow");
  });

  it("denies dangerous shell commands regardless of profile", () => {
    for (const profile of ["cautious", "balanced", "auto-safe"] as const) {
      assert.equal(evaluatePermission("run_command", "Remove-Item -Recurse dist", { profile }), "deny");
    }
  });

  it("only auto-allows workflows in the auto-safe profile", () => {
    assert.equal(evaluatePermission("run_workflow", "recommended", { profile: "balanced" }), "ask");
    assert.equal(evaluatePermission("run_workflow", "recommended", { profile: "auto-safe" }), "allow");
  });

  it("stores approval settings per workspace root", () => {
    assert.notEqual(
      getPermissionSettingsStorageKey("C:/Work/alpha"),
      getPermissionSettingsStorageKey("C:/Work/beta")
    );
  });

  it("normalizes unknown values back to defaults", () => {
    assert.deepEqual(normalizePermissionSettings({ profile: "unknown" }), createDefaultPermissionSettings());
  });

  it("exposes human-readable profile copy", () => {
    assert.equal(getPermissionProfileLabel("balanced"), "Balanced");
    assert.match(getPermissionProfileDescription("balanced"), /safe read, build, and test/i);
    assert.equal(getPermissionDecisionLabel("ask"), "review");
  });
});

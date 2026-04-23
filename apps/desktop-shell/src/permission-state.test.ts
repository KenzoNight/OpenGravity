import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearRememberedApprovals,
  createDefaultPermissionSettings,
  evaluateAgentActionPermission,
  evaluatePermission,
  getPermissionDecisionLabel,
  getPermissionProfileDescription,
  getPermissionProfileLabel,
  getPermissionSettingsStorageKey,
  normalizePermissionSettings,
  rememberAgentActionApproval
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
      assert.equal(evaluateAgentActionPermission(action, { profile, rememberedApprovals: [] }), "allow");
    }
  });

  it("allows safe build commands in balanced mode but not in cautious mode", () => {
    assert.equal(
      evaluatePermission("run_command", "npm run test", { profile: "cautious", rememberedApprovals: [] }),
      "ask"
    );
    assert.equal(
      evaluatePermission("run_command", "npm run test", { profile: "balanced", rememberedApprovals: [] }),
      "allow"
    );
  });

  it("denies dangerous shell commands regardless of profile", () => {
    for (const profile of ["cautious", "balanced", "auto-safe"] as const) {
      assert.equal(
        evaluatePermission("run_command", "Remove-Item -Recurse dist", {
          profile,
          rememberedApprovals: ["Remove-Item -Recurse dist"]
        }),
        "deny"
      );
    }
  });

  it("only auto-allows workflows in the auto-safe profile unless trusted", () => {
    assert.equal(
      evaluatePermission("run_workflow", "recommended", { profile: "balanced", rememberedApprovals: [] }),
      "ask"
    );
    assert.equal(
      evaluatePermission("run_workflow", "recommended", { profile: "auto-safe", rememberedApprovals: [] }),
      "allow"
    );
    assert.equal(
      evaluatePermission("run_workflow", "recommended", {
        profile: "balanced",
        rememberedApprovals: ["workflow:recommended"]
      }),
      "allow"
    );
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

  it("can remember and clear a workspace command approval", () => {
    const commandAction = {
      id: "cmd-1",
      label: "Run tests",
      command: "cmake --build build",
      type: "run_command" as const
    };

    const remembered = rememberAgentActionApproval(createDefaultPermissionSettings(), commandAction);
    assert.equal(
      evaluateAgentActionPermission(commandAction, remembered),
      "allow"
    );

    const cleared = clearRememberedApprovals(remembered);
    assert.equal(
      evaluateAgentActionPermission(commandAction, cleared),
      "ask"
    );
  });

  it("exposes human-readable profile copy", () => {
    assert.equal(getPermissionProfileLabel("balanced"), "Balanced");
    assert.match(getPermissionProfileDescription("balanced"), /safe read, build, and test/i);
    assert.equal(getPermissionDecisionLabel("ask"), "review");
  });
});

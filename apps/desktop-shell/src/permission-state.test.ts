import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendPermissionRule,
  clearPermissionRules,
  clearRememberedApprovals,
  createDefaultPermissionSettings,
  evaluateAgentActionPermission,
  evaluatePermission,
  getCustomPermissionRuleCount,
  getPermissionDecisionLabel,
  getPermissionProfileDescription,
  getPermissionProfileLabel,
  getPermissionRulePatternPlaceholder,
  getPermissionRuleSubjectLabel,
  getPermissionSettingsStorageKey,
  normalizePermissionSettings,
  rememberAgentActionApproval,
  removePermissionRule
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
      assert.equal(
        evaluateAgentActionPermission(action, { profile, rememberedApprovals: [], customRules: [] }),
        "allow"
      );
    }
  });

  it("requires review for edit actions in every profile", () => {
    const action = {
      id: "edit-1",
      label: "Edit solver.cpp",
      path: "src/solver.cpp",
      findText: "return oldValue;",
      replaceText: "return newValue;",
      type: "replace_in_file" as const
    };

    for (const profile of ["cautious", "balanced", "auto-safe"] as const) {
      assert.equal(
        evaluateAgentActionPermission(action, { profile, rememberedApprovals: [], customRules: [] }),
        "ask"
      );
    }
  });

  it("allows safe build commands in balanced mode but not in cautious mode", () => {
    assert.equal(
      evaluatePermission("run_command", "npm run test", {
        profile: "cautious",
        rememberedApprovals: [],
        customRules: []
      }),
      "ask"
    );
    assert.equal(
      evaluatePermission("run_command", "npm run test", {
        profile: "balanced",
        rememberedApprovals: [],
        customRules: []
      }),
      "allow"
    );
  });

  it("denies dangerous shell commands regardless of profile", () => {
    for (const profile of ["cautious", "balanced", "auto-safe"] as const) {
      assert.equal(
        evaluatePermission("run_command", "Remove-Item -Recurse dist", {
          profile,
          rememberedApprovals: ["Remove-Item -Recurse dist"],
          customRules: [{ id: "rule-1", subject: "run_command", pattern: "Remove-Item *", action: "allow" }]
        }),
        "deny"
      );
    }
  });

  it("only auto-allows workflows in the auto-safe profile unless trusted", () => {
    assert.equal(
      evaluatePermission("run_workflow", "recommended", {
        profile: "balanced",
        rememberedApprovals: [],
        customRules: []
      }),
      "ask"
    );
    assert.equal(
      evaluatePermission("run_workflow", "recommended", {
        profile: "auto-safe",
        rememberedApprovals: [],
        customRules: []
      }),
      "allow"
    );
    assert.equal(
      evaluatePermission("run_workflow", "recommended", {
        profile: "balanced",
        rememberedApprovals: ["workflow:recommended"],
        customRules: []
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
      command: "custom-tool build",
      type: "run_command" as const
    };

    const remembered = rememberAgentActionApproval(createDefaultPermissionSettings(), commandAction);
    assert.equal(evaluateAgentActionPermission(commandAction, remembered), "allow");

    const cleared = clearRememberedApprovals(remembered);
    assert.equal(evaluateAgentActionPermission(commandAction, cleared), "ask");
  });

  it("can remember approvals for launching a local skill", () => {
    const skillAction = {
      id: "skill-1",
      label: "Launch Ghidra",
      skillId: "skill-ghidra",
      type: "launch_skill" as const
    };

    const remembered = rememberAgentActionApproval(createDefaultPermissionSettings(), skillAction);
    assert.equal(evaluateAgentActionPermission(skillAction, remembered), "allow");
  });

  it("supports custom allow, ask, and deny rules for commands and workflows", () => {
    let settings = createDefaultPermissionSettings();
    settings = appendPermissionRule(settings, "run_command", "python *", "deny");
    settings = appendPermissionRule(settings, "run_command", "npm run lint", "ask");
    settings = appendPermissionRule(settings, "run_workflow", "recommended", "deny");

    assert.equal(evaluatePermission("run_command", "python app.py", settings), "deny");
    assert.equal(evaluatePermission("run_command", "npm run lint", settings), "ask");
    assert.equal(evaluatePermission("run_workflow", "recommended", settings), "deny");
    assert.equal(getCustomPermissionRuleCount(settings), 3);
  });

  it("removes and clears custom rules without touching remembered approvals", () => {
    const base = rememberAgentActionApproval(createDefaultPermissionSettings(), {
      id: "cmd-1",
      label: "Run tests",
      command: "custom-tool build",
      type: "run_command" as const
    });
    const withRule = appendPermissionRule(base, "run_command", "cmake *", "allow");
    const removed = removePermissionRule(withRule, withRule.customRules[0]?.id ?? "missing");
    const cleared = clearPermissionRules(withRule);

    assert.equal(removed.customRules.length, 0);
    assert.equal(cleared.rememberedApprovals.length, 1);
  });

  it("exposes human-readable profile and rule copy", () => {
    assert.equal(getPermissionProfileLabel("balanced"), "Balanced");
    assert.match(getPermissionProfileDescription("balanced"), /safe read, build, and test/i);
    assert.equal(getPermissionDecisionLabel("ask"), "review");
    assert.equal(getPermissionRuleSubjectLabel("run_command"), "Command");
    assert.match(getPermissionRulePatternPlaceholder("run_workflow"), /recommended/i);
  });
});



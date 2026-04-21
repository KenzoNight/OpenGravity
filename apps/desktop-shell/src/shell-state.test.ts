import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { browserFallbackHealth, buildDesktopShellSnapshot, desktopShellModels } from "./shell-state.js";
import {
  createDefaultWorkbenchSettings,
  getPrimaryProviderAccount,
  updateProviderAccount,
  updateProviderProfile
} from "./settings-state.js";

function createConfiguredSettings() {
  const defaults = createDefaultWorkbenchSettings(desktopShellModels);
  const anthropicAccount = getPrimaryProviderAccount(defaults, "anthropic");
  const geminiAccount = getPrimaryProviderAccount(defaults, "gemini");

  return updateProviderAccount(
    updateProviderAccount(defaults, anthropicAccount!.id, { apiKey: "sk-ant-user-9090" }, desktopShellModels),
    geminiAccount!.id,
    { apiKey: "AIza-user-key-7812" },
    desktopShellModels
  );
}

describe("buildDesktopShellSnapshot", () => {
  it("builds a C++ handoff session with the expected execution profile", () => {
    const snapshot = buildDesktopShellSnapshot(browserFallbackHealth, createConfiguredSettings());

    assert.equal(snapshot.setupRequired, false);
    assert.equal(snapshot.profile.primaryLanguage, "cpp");
    assert.equal(snapshot.executionPlan.primaryBuildSystem, "cmake");
    assert.equal(snapshot.failure.category, "missing-header");
    assert.equal(snapshot.handoffPlan.nextModel.id, "gemini-2.5-pro");
    assert.ok(snapshot.handoffPlan.continuityPack.fallbackTrail.includes("gemini-2.5-pro"));
  });

  it("keeps runtime state, events, and artifacts aligned after the handoff", () => {
    const snapshot = buildDesktopShellSnapshot(browserFallbackHealth, createConfiguredSettings());
    const compileTask = snapshot.tasks.find((task) => task.id === "compile-repair");
    const builder = snapshot.agents.find((agent) => agent.id === "builder-1");

    assert.equal(snapshot.runtimeStats.running, 1);
    assert.equal(compileTask?.status, "running");
    assert.equal(builder?.status, "busy");
    assert.ok(snapshot.sessionRecord.events.some((event) => event.type === "provider_handoff_planned"));
    assert.ok(snapshot.sessionRecord.artifacts.some((artifact) => artifact.kind === "continuity-pack"));
    assert.ok(snapshot.sessionRecord.artifacts.some((artifact) => artifact.kind === "task-snapshot"));
  });

  it("starts in setup-required mode when no provider is configured", () => {
    const snapshot = buildDesktopShellSnapshot(browserFallbackHealth);
    const compileTask = snapshot.tasks.find((task) => task.id === "compile-repair");

    assert.equal(snapshot.setupRequired, true);
    assert.equal(snapshot.runtimeStats.running, 0);
    assert.equal(compileTask?.status, "blocked");
    assert.ok(
      snapshot.providerHealth.every((provider) => provider.state === "offline")
    );
    assert.equal(snapshot.handoffPlan.reasons[0], "setup-required");
  });

  it("uses local provider settings to shape handoff routing", () => {
    const defaults = createDefaultWorkbenchSettings(desktopShellModels);
    const anthropicAccount = getPrimaryProviderAccount(defaults, "anthropic");
    const openAiAccount = getPrimaryProviderAccount(defaults, "openai");
    const settings = updateProviderProfile(
      updateProviderAccount(
        updateProviderAccount(
          updateProviderProfile(
            defaults,
            "gemini",
            {
              enabled: false
            },
            desktopShellModels
          ),
          anthropicAccount!.id,
          {
            apiKey: "sk-ant-user-9090"
          },
          desktopShellModels
        ),
        openAiAccount!.id,
        {
          apiKey: "sk-user-openai-2048"
        },
        desktopShellModels
      ),
      "openai",
      {
        enabled: true
      },
      desktopShellModels
    );

    const snapshot = buildDesktopShellSnapshot(browserFallbackHealth, settings);

    assert.equal(snapshot.handoffPlan.nextModel.id, "gpt-5");
    assert.ok(snapshot.providerHealth.some((provider) => provider.provider === "gemini" && provider.state === "offline"));
  });
});

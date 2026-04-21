import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { desktopShellModels } from "./shell-state.js";
import {
  createDefaultWorkbenchSettings,
  getAvailableModelIds,
  getProviderConnectionLabel,
  maskSecret,
  normalizeWorkbenchSettings,
  setActiveModel,
  updateProviderProfile
} from "./settings-state.js";

describe("settings-state", () => {
  it("creates usable default workbench settings", () => {
    const settings = createDefaultWorkbenchSettings(desktopShellModels);

    assert.equal(settings.activeModelId, "claude-4-opus");
    assert.ok(settings.providerProfiles.some((profile) => profile.provider === "anthropic" && profile.enabled));
    assert.equal(getAvailableModelIds(settings, desktopShellModels).length, 0);
  });

  it("normalizes invalid input back to a safe configuration", () => {
    const settings = normalizeWorkbenchSettings(
      {
        activeModelId: "missing-model",
        autoHandoff: false,
        providerProfiles: [
          {
            provider: "gemini",
            enabled: true,
            apiKey: "AIza-user-key-7812",
            preferredModelId: "gemini-2.5-pro"
          }
        ]
      },
      desktopShellModels
    );

    assert.equal(settings.autoHandoff, false);
    assert.equal(settings.activeModelId, "gemini-2.5-pro");
    assert.equal(
      settings.providerProfiles.find((profile) => profile.provider === "gemini")?.apiKey,
      "AIza-user-key-7812"
    );
  });

  it("updates providers and active model in a controlled way", () => {
    const defaults = createDefaultWorkbenchSettings(desktopShellModels);
    const configured = updateProviderProfile(
      updateProviderProfile(
        defaults,
        "gemini",
        {
          enabled: false,
          apiKey: ""
        },
        desktopShellModels
      ),
      "openai",
      {
        apiKey: "sk-user-openai-2048"
      },
      desktopShellModels
    );
    const switched = setActiveModel(configured, "gpt-5", desktopShellModels);

    assert.ok(!getAvailableModelIds(configured, desktopShellModels).includes("gemini-2.5-pro"));
    assert.equal(switched.activeModelId, "gpt-5");
    assert.equal(maskSecret("sk-user-openai-2048"), "sk-u***2048");
    assert.equal(
      getProviderConnectionLabel(configured.providerProfiles.find((profile) => profile.provider === "gemini")!),
      "Disabled"
    );
  });
});

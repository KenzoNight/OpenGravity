import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { desktopShellModels } from "./shell-state.js";
import {
  addProviderAccount,
  createDefaultWorkbenchSettings,
  getAvailableModelIds,
  getPrimaryProviderAccount,
  getProviderConnectionLabel,
  maskSecret,
  normalizeWorkbenchSettings,
  setActiveModel,
  setPrimaryProviderAccount,
  updateProviderAccount,
  updateProviderProfile
} from "./settings-state.js";

describe("settings-state", () => {
  it("creates default workbench settings with provider accounts", () => {
    const settings = createDefaultWorkbenchSettings(desktopShellModels);

    assert.equal(settings.activeModelId, "claude-4-opus");
    assert.ok(settings.providerProfiles.some((profile) => profile.provider === "anthropic" && profile.enabled));
    assert.ok(settings.providerAccounts.some((account) => account.provider === "anthropic"));
    assert.equal(getAvailableModelIds(settings, desktopShellModels).length, 0);
  });

  it("normalizes legacy profile keys into provider accounts", () => {
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
      getPrimaryProviderAccount(settings, "gemini")?.apiKey,
      "AIza-user-key-7812"
    );
  });

  it("updates providers, multiple accounts, and active model in a controlled way", () => {
    const defaults = createDefaultWorkbenchSettings(desktopShellModels);
    const withExtraAccount = addProviderAccount(defaults, "openrouter");
    const primaryAnthropic = getPrimaryProviderAccount(withExtraAccount, "anthropic");
    const firstOpenRouter = getPrimaryProviderAccount(withExtraAccount, "openrouter");
    const secondOpenRouter = withExtraAccount.providerAccounts.find(
      (account) => account.provider === "openrouter" && account.id !== firstOpenRouter?.id
    );

    assert.ok(primaryAnthropic);
    assert.ok(firstOpenRouter);
    assert.ok(secondOpenRouter);

    const configured = setPrimaryProviderAccount(
      updateProviderProfile(
        updateProviderProfile(
          updateProviderAccount(
            updateProviderAccount(
              withExtraAccount,
              primaryAnthropic!.id,
              {
                apiKey: "sk-ant-user-9090"
              },
              desktopShellModels
            ),
            secondOpenRouter!.id,
            {
              apiKey: "sk-or-user-2048",
              baseUrl: "https://openrouter.ai/api/v1",
              label: "OpenRouter Backup"
            },
            desktopShellModels
          ),
          "gemini",
          {
            enabled: false
          },
          desktopShellModels
        ),
        "openrouter",
        {
          enabled: true,
          preferredModelId: "openrouter-claude-4-sonnet"
        },
        desktopShellModels
      ),
      "openrouter",
      secondOpenRouter!.id,
      desktopShellModels
    );
    const switched = setActiveModel(configured, "claude-4-opus", desktopShellModels);

    assert.ok(!getAvailableModelIds(configured, desktopShellModels).includes("gemini-2.5-pro"));
    assert.equal(switched.activeModelId, "claude-4-opus");
    assert.equal(maskSecret("sk-user-openai-2048"), "sk-u***2048");
    assert.equal(
      getProviderConnectionLabel(configured.providerProfiles.find((profile) => profile.provider === "gemini")!, configured),
      "Disabled"
    );
    assert.equal(
      getProviderConnectionLabel(
        configured.providerProfiles.find((profile) => profile.provider === "openrouter")!,
        configured
      ),
      "Configured · sk-o***2048"
    );
  });
});

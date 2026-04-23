import type { ModelDescriptor, ModelProvider, ProviderHealth, ProviderHealthState } from "@opengravity/shared-types";

import {
  getPrimaryProviderAccount,
  getProviderAccounts,
  getProviderConnectionLabel,
  getProviderConnectionState,
  getReadyProviderAccounts,
  type ProviderConnectionState,
  type WorkbenchSettings
} from "./settings-state";

export interface ProviderRadarEntry {
  provider: ModelProvider;
  label: string;
  connectionLabel: string;
  connectionState: ProviderConnectionState;
  totalAccountCount: number;
  readyAccountCount: number;
  preferredModelId: string;
  preferredModelLabel: string;
  primaryAccountId: string;
  primaryAccountLabel: string;
  healthState: ProviderHealthState;
  healthReason: string;
  score: number;
}

export interface ProviderRadarSummary {
  entries: ProviderRadarEntry[];
  recommended?: ProviderRadarEntry;
  fallback?: ProviderRadarEntry;
  active?: ProviderRadarEntry;
  readyProviderCount: number;
  readyAccountCount: number;
}

function getHealthEntry(providerHealth: ProviderHealth[], provider: ModelProvider): ProviderHealth | undefined {
  return providerHealth.find((entry) => entry.provider === provider);
}

function getHealthScore(state: ProviderHealthState): number {
  switch (state) {
    case "healthy":
      return 24;
    case "degraded":
      return 8;
    case "rate_limited":
      return -32;
    case "offline":
      return -90;
  }
}

function getConnectionScore(state: ProviderConnectionState): number {
  switch (state) {
    case "ready":
      return 70;
    case "disabled":
      return -120;
    case "missing-base-url":
    case "missing-api-key":
      return -55;
  }
}

function byScoreThenLabel(left: ProviderRadarEntry, right: ProviderRadarEntry): number {
  return right.score - left.score || left.label.localeCompare(right.label);
}

export function buildProviderRadar(
  settings: WorkbenchSettings,
  providerHealth: ProviderHealth[],
  models: ModelDescriptor[]
): ProviderRadarSummary {
  const entries = settings.providerProfiles
    .map((profile) => {
      const accounts = getProviderAccounts(settings, profile.provider);
      const readyAccounts = getReadyProviderAccounts(settings, profile.provider);
      const primaryAccount = getPrimaryProviderAccount(settings, profile.provider);
      const healthEntry = getHealthEntry(providerHealth, profile.provider);
      const preferredModel = models.find((model) => model.id === profile.preferredModelId);
      const connectionState = getProviderConnectionState(profile, settings);
      const healthState = healthEntry?.state ?? "offline";
      const score =
        getConnectionScore(connectionState) +
        getHealthScore(healthState) +
        readyAccounts.length * 10 +
        (settings.activeModelId === profile.preferredModelId ? 6 : 0) +
        (profile.allowFallback ? 2 : 0);

      return {
        provider: profile.provider,
        label: profile.label,
        connectionLabel: getProviderConnectionLabel(profile, settings),
        connectionState,
        totalAccountCount: accounts.length,
        readyAccountCount: readyAccounts.length,
        preferredModelId: profile.preferredModelId,
        preferredModelLabel: preferredModel?.label ?? (profile.preferredModelId || "No preferred model"),
        primaryAccountId: primaryAccount?.id ?? "",
        primaryAccountLabel: primaryAccount?.label ?? "No account selected",
        healthState,
        healthReason: healthEntry?.reason ?? "No provider health sample is available yet.",
        score
      } satisfies ProviderRadarEntry;
    })
    .sort(byScoreThenLabel);

  const readyEntries = entries.filter((entry) => entry.connectionState === "ready" && entry.readyAccountCount > 0);
  const activeProvider = models.find((model) => model.id === settings.activeModelId)?.provider;

  return {
    entries,
    recommended: readyEntries[0],
    fallback: readyEntries[1],
    active: entries.find((entry) => entry.provider === activeProvider),
    readyProviderCount: readyEntries.length,
    readyAccountCount: readyEntries.reduce((sum, entry) => sum + entry.readyAccountCount, 0)
  };
}


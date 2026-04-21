import type { ModelDescriptor, ModelProvider } from "@opengravity/shared-types";

export const settingsStorageKey = "opengravity.workbench-settings.v1";

export interface ProviderAccount {
  id: string;
  provider: ModelProvider;
  label: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
}

export interface ProviderProfile {
  provider: ModelProvider;
  label: string;
  enabled: boolean;
  preferredModelId: string;
  allowFallback: boolean;
  primaryAccountId: string;
}

export interface WorkbenchSettings {
  activeModelId: string;
  autoHandoff: boolean;
  providerProfiles: ProviderProfile[];
  providerAccounts: ProviderAccount[];
}

export type ProviderConnectionState =
  | "ready"
  | "disabled"
  | "missing-api-key"
  | "missing-base-url";

const providerOrder: ModelProvider[] = [
  "anthropic",
  "gemini",
  "openai",
  "openrouter",
  "ollama",
  "custom"
];

const providerLabels: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  custom: "Custom"
};

const defaultEnabledProviders = new Set<ModelProvider>(["anthropic", "gemini", "openai"]);

const defaultBaseUrls: Partial<Record<ModelProvider, string>> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://127.0.0.1:11434/v1",
  custom: "https://api.example.com/v1"
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const hasOwn = <T extends object>(value: T | undefined, key: PropertyKey): boolean =>
  Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

const providerRequiresApiKey = (provider: ModelProvider): boolean => provider !== "ollama";

const providerRequiresBaseUrl = (provider: ModelProvider): boolean =>
  provider === "openrouter" || provider === "ollama" || provider === "custom";

function createProviderAccountId(provider: ModelProvider, index: number): string {
  return `${provider}-account-${index}`;
}

function createDefaultProviderAccount(provider: ModelProvider, index = 1): ProviderAccount {
  return {
    id: createProviderAccountId(provider, index),
    provider,
    label: index === 1 ? `${providerLabels[provider]} Default` : `${providerLabels[provider]} ${index}`,
    enabled: true,
    apiKey: "",
    baseUrl: defaultBaseUrls[provider] ?? ""
  };
}

function isAccountReady(provider: ModelProvider, account: ProviderAccount): boolean {
  if (!account.enabled) {
    return false;
  }

  if (providerRequiresBaseUrl(provider) && !account.baseUrl.trim()) {
    return false;
  }

  if (providerRequiresApiKey(provider) && !account.apiKey.trim()) {
    return false;
  }

  return true;
}

function resolveProviderAccounts(
  settingsOrAccounts: WorkbenchSettings | ProviderAccount[] | undefined,
  provider: ModelProvider
): ProviderAccount[] {
  if (!settingsOrAccounts) {
    return [];
  }

  const accounts = Array.isArray(settingsOrAccounts)
    ? settingsOrAccounts
    : settingsOrAccounts.providerAccounts;

  return accounts.filter((account) => account.provider === provider);
}

function getProviderModelMap(models: ModelDescriptor[]): Map<ModelProvider, ModelDescriptor[]> {
  const modelMap = new Map<ModelProvider, ModelDescriptor[]>();

  for (const provider of providerOrder) {
    modelMap.set(
      provider,
      models.filter((model) => model.provider === provider)
    );
  }

  return modelMap;
}

function isArbitraryModelProvider(provider: ModelProvider): boolean {
  return provider === "custom";
}

function normalizeProviderAccount(
  provider: ModelProvider,
  input: Partial<ProviderAccount> | undefined,
  fallback: ProviderAccount,
  index: number
): ProviderAccount {
  return {
    id: normalizeString(input?.id) || fallback.id || createProviderAccountId(provider, index + 1),
    provider,
    label: normalizeString(input?.label) || fallback.label,
    enabled: typeof input?.enabled === "boolean" ? input.enabled : fallback.enabled,
    apiKey: hasOwn(input ?? {}, "apiKey") ? normalizeString(input?.apiKey) : fallback.apiKey,
    baseUrl: hasOwn(input ?? {}, "baseUrl") ? normalizeString(input?.baseUrl) : fallback.baseUrl
  };
}

function getFallbackActiveModelId(
  profiles: ProviderProfile[],
  accounts: ProviderAccount[],
  models: ModelDescriptor[],
  currentActiveModelId: string
): string {
  const availableModelIds = new Set(
    models
      .filter((model) => {
        const profile = profiles.find((entry) => entry.provider === model.provider);
        return Boolean(profile && isProviderReady(profile, accounts));
      })
      .map((model) => model.id)
  );

  if (availableModelIds.has(currentActiveModelId)) {
    return currentActiveModelId;
  }

  for (const profile of profiles) {
    if (!isProviderReady(profile, accounts)) {
      continue;
    }

    if (profile.preferredModelId && availableModelIds.has(profile.preferredModelId)) {
      return profile.preferredModelId;
    }
  }

  return models[0]?.id ?? "";
}

export function createDefaultWorkbenchSettings(models: ModelDescriptor[]): WorkbenchSettings {
  const modelMap = getProviderModelMap(models);
  const providerAccounts = providerOrder.map((provider) => createDefaultProviderAccount(provider));
  const providerProfiles = providerOrder.map((provider) => {
    const providerModels = modelMap.get(provider) ?? [];
    const preferredModelId = providerModels[0]?.id ?? "";
    const account = providerAccounts.find((entry) => entry.provider === provider)!;

    return {
      provider,
      label: providerLabels[provider],
      enabled: defaultEnabledProviders.has(provider),
      preferredModelId,
      allowFallback: true,
      primaryAccountId: account.id
    } satisfies ProviderProfile;
  });

  const activeModelId =
    providerProfiles.find((profile) => profile.enabled && isProviderReady(profile, providerAccounts) && profile.preferredModelId)?.preferredModelId ??
    models[0]?.id ??
    "";

  return {
    activeModelId,
    autoHandoff: true,
    providerProfiles,
    providerAccounts
  };
}

export function getModelsForProvider(models: ModelDescriptor[], provider: ModelProvider): ModelDescriptor[] {
  return models.filter((model) => model.provider === provider);
}

export function getProviderAccounts(settings: WorkbenchSettings, provider: ModelProvider): ProviderAccount[] {
  return settings.providerAccounts.filter((account) => account.provider === provider);
}

export function getPrimaryProviderAccount(
  settings: WorkbenchSettings,
  provider: ModelProvider
): ProviderAccount | undefined {
  const profile = settings.providerProfiles.find((entry) => entry.provider === provider);
  const accounts = getProviderAccounts(settings, provider);

  return accounts.find((account) => account.id === profile?.primaryAccountId) ?? accounts[0];
}

export function getReadyProviderAccounts(settings: WorkbenchSettings, provider: ModelProvider): ProviderAccount[] {
  const profile = settings.providerProfiles.find((entry) => entry.provider === provider);
  if (!profile || !profile.enabled) {
    return [];
  }

  return getProviderAccounts(settings, provider).filter((account) => isAccountReady(provider, account));
}

export function normalizeWorkbenchSettings(input: unknown, models: ModelDescriptor[]): WorkbenchSettings {
  const defaults = createDefaultWorkbenchSettings(models);
  if (!input || typeof input !== "object") {
    return defaults;
  }

  const value = input as Partial<WorkbenchSettings>;
  const providerInputs = Array.isArray(value.providerProfiles) ? value.providerProfiles : [];
  const accountInputs = Array.isArray(value.providerAccounts) ? value.providerAccounts : [];

  const byProvider = new Map<ModelProvider, Partial<ProviderProfile> & { provider: ModelProvider }>();
  for (const profile of providerInputs) {
    if (!profile || typeof profile !== "object") {
      continue;
    }

    const provider = (profile as { provider?: unknown }).provider;
    if (typeof provider !== "string") {
      continue;
    }

    byProvider.set(provider as ModelProvider, profile as Partial<ProviderProfile> & { provider: ModelProvider });
  }

  const accountsByProvider = new Map<ModelProvider, Partial<ProviderAccount>[]>();
  for (const account of accountInputs) {
    if (!account || typeof account !== "object") {
      continue;
    }

    const provider = (account as { provider?: unknown }).provider;
    if (typeof provider !== "string") {
      continue;
    }

    const existing = accountsByProvider.get(provider as ModelProvider) ?? [];
    existing.push(account as Partial<ProviderAccount>);
    accountsByProvider.set(provider as ModelProvider, existing);
  }

  const providerProfiles = defaults.providerProfiles.map((profile) => {
    const incoming = byProvider.get(profile.provider);
    const providerModels = getModelsForProvider(models, profile.provider);
    const preferredModelId = normalizeString(incoming?.preferredModelId);
    const safeModelId =
      isArbitraryModelProvider(profile.provider) && preferredModelId
        ? preferredModelId
        : providerModels.some((model) => model.id === preferredModelId)
          ? preferredModelId
          : profile.preferredModelId;

    return {
      ...profile,
      enabled: typeof incoming?.enabled === "boolean" ? incoming.enabled : profile.enabled,
      preferredModelId: safeModelId,
      allowFallback: typeof incoming?.allowFallback === "boolean" ? incoming.allowFallback : profile.allowFallback,
      primaryAccountId: normalizeString(incoming?.primaryAccountId) || profile.primaryAccountId
    };
  });

  const providerAccounts = providerOrder.flatMap((provider) => {
    const defaultsForProvider = defaults.providerAccounts.filter((account) => account.provider === provider);
    const incomingAccounts = accountsByProvider.get(provider) ?? [];
    const legacyProfile = byProvider.get(provider);

    if (incomingAccounts.length === 0) {
      const fallback = defaultsForProvider[0] ?? createDefaultProviderAccount(provider);
      const seededFromLegacy = normalizeProviderAccount(
        provider,
        {
          apiKey: hasOwn(legacyProfile ?? {}, "apiKey")
            ? normalizeString((legacyProfile as { apiKey?: unknown }).apiKey)
            : fallback.apiKey,
          baseUrl: hasOwn(legacyProfile ?? {}, "baseUrl")
            ? normalizeString((legacyProfile as { baseUrl?: unknown }).baseUrl)
            : fallback.baseUrl,
          enabled: true,
          id: fallback.id,
          label: fallback.label
        },
        fallback,
        0
      );

      return [seededFromLegacy];
    }

    return incomingAccounts.map((account, index) =>
      normalizeProviderAccount(
        provider,
        account,
        defaultsForProvider[index] ?? createDefaultProviderAccount(provider, index + 1),
        index
      )
    );
  });

  const normalizedProfiles = providerProfiles.map((profile) => {
    const providerAccountsForProfile = providerAccounts.filter((account) => account.provider === profile.provider);
    const primaryAccountId = providerAccountsForProfile.some((account) => account.id === profile.primaryAccountId)
      ? profile.primaryAccountId
      : providerAccountsForProfile[0]?.id ?? "";

    return {
      ...profile,
      primaryAccountId
    };
  });

  const allowedModelIds = new Set(getAvailableModelIds({ ...defaults, providerProfiles: normalizedProfiles, providerAccounts }, models));
  const requestedActiveModelId = normalizeString(value.activeModelId);
  const activeModelId = allowedModelIds.has(requestedActiveModelId)
    ? requestedActiveModelId
    : getFallbackActiveModelId(normalizedProfiles, providerAccounts, models, defaults.activeModelId);

  return {
    activeModelId,
    autoHandoff: typeof value.autoHandoff === "boolean" ? value.autoHandoff : defaults.autoHandoff,
    providerProfiles: normalizedProfiles,
    providerAccounts
  };
}

export function serializeWorkbenchSettings(settings: WorkbenchSettings): string {
  return JSON.stringify(settings);
}

export function updateProviderProfile(
  settings: WorkbenchSettings,
  provider: ModelProvider,
  patch: Partial<Omit<ProviderProfile, "provider" | "label">>,
  models: ModelDescriptor[]
): WorkbenchSettings {
  const providerProfiles = settings.providerProfiles.map((profile) => {
    if (profile.provider !== provider) {
      return profile;
    }

    const nextProfile: ProviderProfile = {
      ...profile,
      ...patch
    };

    const providerModels = getModelsForProvider(models, provider);
    if (
      !isArbitraryModelProvider(provider) &&
      !providerModels.some((model) => model.id === nextProfile.preferredModelId)
    ) {
      nextProfile.preferredModelId = providerModels[0]?.id ?? "";
    }

    const providerAccounts = getProviderAccounts(settings, provider);
    if (!providerAccounts.some((account) => account.id === nextProfile.primaryAccountId)) {
      nextProfile.primaryAccountId = providerAccounts[0]?.id ?? "";
    }

    return nextProfile;
  });

  return {
    ...settings,
    providerProfiles,
    activeModelId: getFallbackActiveModelId(providerProfiles, settings.providerAccounts, models, settings.activeModelId)
  };
}

export function addProviderAccount(settings: WorkbenchSettings, provider: ModelProvider): WorkbenchSettings {
  const providerAccounts = getProviderAccounts(settings, provider);
  const nextAccount = createDefaultProviderAccount(provider, providerAccounts.length + 1);

  return {
    ...settings,
    providerAccounts: [...settings.providerAccounts, nextAccount],
    providerProfiles: settings.providerProfiles.map((profile) =>
      profile.provider === provider && !profile.primaryAccountId
        ? {
            ...profile,
            primaryAccountId: nextAccount.id
          }
        : profile
    )
  };
}

export function updateProviderAccount(
  settings: WorkbenchSettings,
  accountId: string,
  patch: Partial<Omit<ProviderAccount, "id" | "provider">>,
  models: ModelDescriptor[]
): WorkbenchSettings {
  const providerAccounts = settings.providerAccounts.map((account) =>
    account.id === accountId
      ? {
          ...account,
          ...patch
        }
      : account
  );

  return {
    ...settings,
    providerAccounts,
    activeModelId: getFallbackActiveModelId(
      settings.providerProfiles,
      providerAccounts,
      models,
      settings.activeModelId
    )
  };
}

export function removeProviderAccount(
  settings: WorkbenchSettings,
  accountId: string,
  models: ModelDescriptor[]
): WorkbenchSettings {
  const account = settings.providerAccounts.find((entry) => entry.id === accountId);
  if (!account) {
    return settings;
  }

  const providerAccounts = settings.providerAccounts.filter((entry) => entry.id !== accountId);
  const remainingForProvider = providerAccounts.filter((entry) => entry.provider === account.provider);
  if (remainingForProvider.length === 0) {
    return settings;
  }

  const providerProfiles = settings.providerProfiles.map((profile) =>
    profile.provider === account.provider && profile.primaryAccountId === accountId
      ? {
          ...profile,
          primaryAccountId: remainingForProvider[0]!.id
        }
      : profile
  );

  return {
    ...settings,
    providerProfiles,
    providerAccounts,
    activeModelId: getFallbackActiveModelId(providerProfiles, providerAccounts, models, settings.activeModelId)
  };
}

export function setPrimaryProviderAccount(
  settings: WorkbenchSettings,
  provider: ModelProvider,
  accountId: string,
  models: ModelDescriptor[]
): WorkbenchSettings {
  const providerAccounts = getProviderAccounts(settings, provider);
  if (!providerAccounts.some((account) => account.id === accountId)) {
    return settings;
  }

  return updateProviderProfile(
    settings,
    provider,
    {
      primaryAccountId: accountId
    },
    models
  );
}

export function setActiveModel(settings: WorkbenchSettings, modelId: string, models: ModelDescriptor[]): WorkbenchSettings {
  const availableModelIds = new Set(getAvailableModelIds(settings, models));
  if (!availableModelIds.has(modelId)) {
    return settings;
  }

  return {
    ...settings,
    activeModelId: modelId
  };
}

export function getAvailableModelIds(settings: WorkbenchSettings, models: ModelDescriptor[]): string[] {
  const profileMap = new Map(settings.providerProfiles.map((profile) => [profile.provider, profile]));

  return models
    .filter((model) => {
      const profile = profileMap.get(model.provider);
      return Boolean(profile && isProviderReady(profile, settings));
    })
    .map((model) => model.id);
}

export function getProviderConnectionState(
  profile: ProviderProfile,
  settingsOrAccounts?: WorkbenchSettings | ProviderAccount[]
): ProviderConnectionState {
  if (!profile.enabled) {
    return "disabled";
  }

  const accounts = resolveProviderAccounts(settingsOrAccounts, profile.provider);
  const readyAccounts = accounts.filter((account) => isAccountReady(profile.provider, account));
  if (readyAccounts.length > 0) {
    return "ready";
  }

  const primaryAccount = accounts.find((account) => account.id === profile.primaryAccountId) ?? accounts[0];

  if (providerRequiresBaseUrl(profile.provider) && !primaryAccount?.baseUrl.trim()) {
    return "missing-base-url";
  }

  if (providerRequiresApiKey(profile.provider) && !primaryAccount?.apiKey.trim()) {
    return "missing-api-key";
  }

  return providerRequiresApiKey(profile.provider) ? "missing-api-key" : "missing-base-url";
}

export function isProviderReady(
  profile: ProviderProfile,
  settingsOrAccounts?: WorkbenchSettings | ProviderAccount[]
): boolean {
  return getProviderConnectionState(profile, settingsOrAccounts) === "ready";
}

export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) {
    return "Not configured";
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

export function getProviderConnectionLabel(
  profile: ProviderProfile,
  settingsOrAccounts?: WorkbenchSettings | ProviderAccount[]
): string {
  const state = getProviderConnectionState(profile, settingsOrAccounts);

  switch (state) {
    case "disabled":
      return "Disabled";
    case "missing-base-url":
      return "Missing base URL";
    case "missing-api-key":
      return "Missing API key";
    case "ready": {
      const accounts = resolveProviderAccounts(settingsOrAccounts, profile.provider);
      const readyAccounts = accounts.filter((account) => isAccountReady(profile.provider, account));
      const primaryReadyAccount =
        readyAccounts.find((account) => account.id === profile.primaryAccountId) ?? readyAccounts[0];

      if (profile.provider === "ollama") {
        return readyAccounts.length > 1
          ? `${readyAccounts.length} runtimes ready`
          : `Local runtime · ${primaryReadyAccount?.baseUrl ?? ""}`;
      }

      if (profile.provider === "custom") {
        return readyAccounts.length > 1
          ? `${readyAccounts.length} endpoints ready`
          : `Configured endpoint · ${primaryReadyAccount?.baseUrl ?? ""}`;
      }

      return readyAccounts.length > 1
        ? `${readyAccounts.length} accounts ready`
        : `Configured · ${maskSecret(primaryReadyAccount?.apiKey ?? "")}`;
    }
  }
}

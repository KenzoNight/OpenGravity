import type { ModelDescriptor, ModelProvider } from "@opengravity/shared-types";

export const settingsStorageKey = "opengravity.workbench-settings.v1";

export interface ProviderProfile {
  provider: ModelProvider;
  label: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  preferredModelId: string;
  allowFallback: boolean;
}

export interface WorkbenchSettings {
  activeModelId: string;
  autoHandoff: boolean;
  providerProfiles: ProviderProfile[];
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

export function createDefaultWorkbenchSettings(models: ModelDescriptor[]): WorkbenchSettings {
  const modelMap = getProviderModelMap(models);
  const providerProfiles = providerOrder.map((provider) => {
    const providerModels = modelMap.get(provider) ?? [];
    const preferredModelId = providerModels[0]?.id ?? "";

    return {
      provider,
      label: providerLabels[provider],
      enabled: defaultEnabledProviders.has(provider),
      apiKey: "",
      baseUrl: defaultBaseUrls[provider] ?? "",
      preferredModelId,
      allowFallback: true
    } satisfies ProviderProfile;
  });

  const activeModelId =
    providerProfiles.find((profile) => profile.enabled && isProviderReady(profile) && profile.preferredModelId)?.preferredModelId ??
    models[0]?.id ??
    "";

  return {
    activeModelId,
    autoHandoff: true,
    providerProfiles
  };
}

export function getModelsForProvider(models: ModelDescriptor[], provider: ModelProvider): ModelDescriptor[] {
  return models.filter((model) => model.provider === provider);
}

export function normalizeWorkbenchSettings(input: unknown, models: ModelDescriptor[]): WorkbenchSettings {
  const defaults = createDefaultWorkbenchSettings(models);
  if (!input || typeof input !== "object") {
    return defaults;
  }

  const value = input as Partial<WorkbenchSettings>;
  const providerInputs = Array.isArray(value.providerProfiles) ? value.providerProfiles : [];
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

  const providerProfiles = defaults.providerProfiles.map((profile) => {
    const incoming = byProvider.get(profile.provider);
    const providerModels = getModelsForProvider(models, profile.provider);
    const preferredModelId = normalizeString(incoming?.preferredModelId);
    const safeModelId = providerModels.some((model) => model.id === preferredModelId)
      ? preferredModelId
      : profile.preferredModelId;
    const incomingApiKey = hasOwn(incoming, "apiKey")
      ? normalizeString((incoming as { apiKey?: unknown }).apiKey)
      : profile.apiKey;
    const incomingBaseUrl = hasOwn(incoming, "baseUrl")
      ? normalizeString((incoming as { baseUrl?: unknown }).baseUrl)
      : profile.baseUrl;

    return {
      ...profile,
      enabled: typeof incoming?.enabled === "boolean" ? incoming.enabled : profile.enabled,
      apiKey: incomingApiKey,
      baseUrl: incomingBaseUrl,
      preferredModelId: safeModelId,
      allowFallback: typeof incoming?.allowFallback === "boolean" ? incoming.allowFallback : profile.allowFallback
    };
  });

  const allowedModelIds = new Set(getAvailableModelIds({ ...defaults, providerProfiles }, models));
  const requestedActiveModelId = normalizeString(value.activeModelId);
  const activeModelId = allowedModelIds.has(requestedActiveModelId)
    ? requestedActiveModelId
    : getFallbackActiveModelId(providerProfiles, models, defaults.activeModelId);

  return {
    activeModelId,
    autoHandoff: typeof value.autoHandoff === "boolean" ? value.autoHandoff : defaults.autoHandoff,
    providerProfiles
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
    if (!providerModels.some((model) => model.id === nextProfile.preferredModelId)) {
      nextProfile.preferredModelId = providerModels[0]?.id ?? "";
    }

    return nextProfile;
  });

  return {
    ...settings,
    providerProfiles,
    activeModelId: getFallbackActiveModelId(providerProfiles, models, settings.activeModelId)
  };
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
      return Boolean(profile && isProviderReady(profile));
    })
    .map((model) => model.id);
}

export function getProviderConnectionState(profile: ProviderProfile): ProviderConnectionState {
  if (!profile.enabled) {
    return "disabled";
  }

  if (providerRequiresBaseUrl(profile.provider) && !profile.baseUrl.trim()) {
    return "missing-base-url";
  }

  if (providerRequiresApiKey(profile.provider) && !profile.apiKey.trim()) {
    return "missing-api-key";
  }

  return "ready";
}

export function isProviderReady(profile: ProviderProfile): boolean {
  return getProviderConnectionState(profile) === "ready";
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

export function getProviderConnectionLabel(profile: ProviderProfile): string {
  const state = getProviderConnectionState(profile);

  switch (state) {
    case "disabled":
      return "Disabled";
    case "missing-base-url":
      return "Missing base URL";
    case "missing-api-key":
      return "Missing API key";
    case "ready":
      if (profile.provider === "ollama") {
        return `Local runtime · ${profile.baseUrl}`;
      }

      if (profile.provider === "custom") {
        return `Configured endpoint · ${profile.baseUrl}`;
      }

      return `Configured · ${maskSecret(profile.apiKey)}`;
  }
}

function getFallbackActiveModelId(
  profiles: ProviderProfile[],
  models: ModelDescriptor[],
  currentActiveModelId: string
): string {
  const availableModelIds = new Set(
    models
      .filter((model) => {
        const profile = profiles.find((entry) => entry.provider === model.provider);
        return Boolean(profile && isProviderReady(profile));
      })
      .map((model) => model.id)
  );

  if (availableModelIds.has(currentActiveModelId)) {
    return currentActiveModelId;
  }

  for (const profile of profiles) {
    if (!isProviderReady(profile)) {
      continue;
    }

    if (profile.preferredModelId && availableModelIds.has(profile.preferredModelId)) {
      return profile.preferredModelId;
    }
  }

  return models[0]?.id ?? "";
}

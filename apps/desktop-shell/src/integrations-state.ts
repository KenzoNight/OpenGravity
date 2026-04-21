export const integrationsStorageKey = "opengravity.integrations.v1";

export interface IntegrationSettings {
  githubToken: string;
  githubAutoRefresh: boolean;
}

export function createDefaultIntegrationSettings(): IntegrationSettings {
  return {
    githubToken: "",
    githubAutoRefresh: true
  };
}

export function normalizeIntegrationSettings(input: unknown): IntegrationSettings {
  const defaults = createDefaultIntegrationSettings();
  if (!input || typeof input !== "object") {
    return defaults;
  }

  const value = input as Partial<IntegrationSettings>;

  return {
    githubToken: typeof value.githubToken === "string" ? value.githubToken.trim() : defaults.githubToken,
    githubAutoRefresh:
      typeof value.githubAutoRefresh === "boolean" ? value.githubAutoRefresh : defaults.githubAutoRefresh
  };
}

export function serializeIntegrationSettings(settings: IntegrationSettings): string {
  return JSON.stringify(settings);
}

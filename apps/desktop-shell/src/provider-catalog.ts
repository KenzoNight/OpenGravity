import type { CostTier, ModelDescriptor } from "@opengravity/shared-types";

export interface ProviderCatalogModel extends ModelDescriptor {
  isFree: boolean;
  source: "catalog";
}

export interface ProviderCatalogSnapshot {
  fetchedAt: string;
  freeCount: number;
  models: ProviderCatalogModel[];
  provider: "openrouter";
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelRecord[];
}

interface OpenRouterModelRecord {
  context_length?: number;
  id: string;
  name?: string;
  pricing?: {
    completion?: string;
    prompt?: string;
  };
  supported_parameters?: string[];
}

function parseNumericPrice(value: string | undefined): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function resolveCostTier(promptPrice: number, completionPrice: number, isFree: boolean): CostTier {
  if (isFree) {
    return "low";
  }

  const combinedPrice = promptPrice + completionPrice;
  if (combinedPrice <= 0.000003) {
    return "low";
  }

  if (combinedPrice <= 0.00002) {
    return "medium";
  }

  return "high";
}

export function mapOpenRouterCatalog(response: OpenRouterModelsResponse): ProviderCatalogModel[] {
  const models = (response.data ?? []).map((record): ProviderCatalogModel => {
    const promptPrice = parseNumericPrice(record.pricing?.prompt);
    const completionPrice = parseNumericPrice(record.pricing?.completion);
    const isFree = promptPrice === 0 && completionPrice === 0;
    const maxContextWindow = Math.max(4096, record.context_length ?? 65536);

    return {
      id: record.id,
      label: record.name?.trim() || record.id,
      provider: "openrouter",
      qualityTier:
        maxContextWindow >= 200000 ? "strong" : maxContextWindow >= 64000 ? "balanced" : "fast",
      costTier: resolveCostTier(promptPrice, completionPrice, isFree),
      supportsTools: (record.supported_parameters ?? []).includes("tools"),
      maxContextWindow,
      isFree,
      source: "catalog"
    };
  });

  return models.sort((left, right) => {
    if (left.isFree !== right.isFree) {
      return left.isFree ? -1 : 1;
    }

    return left.label.localeCompare(right.label);
  });
}

export async function fetchOpenRouterCatalog(
  apiKey: string,
  baseUrl = "https://openrouter.ai/api/v1"
): Promise<ProviderCatalogSnapshot> {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "") || "https://openrouter.ai/api/v1";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Title": "OpenGravity"
  };

  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const response = await fetch(`${normalizedBaseUrl}/models`, {
    headers,
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`OpenRouter catalog request failed with ${response.status}.`);
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;
  const models = mapOpenRouterCatalog(payload);

  return {
    fetchedAt: new Date().toISOString(),
    freeCount: models.filter((model) => model.isFree).length,
    models,
    provider: "openrouter"
  };
}

export function mergeModelCatalog(
  baseModels: ModelDescriptor[],
  discoveredModels: ProviderCatalogModel[]
): ModelDescriptor[] {
  const discoveredById = new Map(discoveredModels.map((model) => [model.id, model]));
  const merged = baseModels.map((model) => discoveredById.get(model.id) ?? model);

  for (const model of discoveredModels) {
    if (!merged.some((entry) => entry.id === model.id)) {
      merged.push(model);
    }
  }

  return merged;
}

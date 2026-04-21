import type { ModelDescriptor, TaskType } from "@opengravity/shared-types";

export interface RoutedCandidate {
  model: ModelDescriptor;
  available: boolean;
  healthScore: number;
}

export interface RoutingRequest {
  taskType: TaskType;
  activeModelId?: string;
  excludedModelIds?: string[];
  needsLongContext?: boolean;
  requiresStrongReasoning?: boolean;
}

export interface RoutingDecision {
  chosen: ModelDescriptor;
  score: number;
  reasons: string[];
}

const taskBonuses: Record<TaskType, Partial<Record<ModelDescriptor["qualityTier"], number>>> = {
  chat: { fast: 20, balanced: 16, strong: 14 },
  code: { balanced: 20, strong: 18, fast: 10 },
  "build-repair": { strong: 24, balanced: 18, fast: 8 },
  review: { strong: 22, balanced: 16, fast: 8 }
};

export function selectNextModel(
  request: RoutingRequest,
  candidates: RoutedCandidate[]
): RoutingDecision {
  const excluded = new Set(request.excludedModelIds ?? []);

  const scored = candidates
    .filter((candidate) => candidate.available)
    .filter((candidate) => !excluded.has(candidate.model.id))
    .map((candidate) => {
      let score = candidate.healthScore;
      const reasons: string[] = [`health:${candidate.healthScore}`];

      score += taskBonuses[request.taskType][candidate.model.qualityTier] ?? 0;
      reasons.push(`task-fit:${request.taskType}`);

      if (candidate.model.supportsTools) {
        score += 10;
        reasons.push("supports-tools");
      }

      if (request.needsLongContext) {
        const contextBonus = Math.min(candidate.model.maxContextWindow / 16000, 12);
        score += contextBonus;
        reasons.push(`context:${candidate.model.maxContextWindow}`);
      }

      if (request.requiresStrongReasoning && candidate.model.qualityTier === "strong") {
        score += 14;
        reasons.push("strong-reasoning");
      }

      if (candidate.model.id === request.activeModelId) {
        score -= 6;
        reasons.push("avoid-sticky-on-failover");
      }

      return { ...candidate, score, reasons };
    })
    .sort((left, right) => right.score - left.score);

  const top = scored[0];
  if (!top) {
    throw new Error("No eligible model candidates were available for routing.");
  }

  return {
    chosen: top.model,
    score: top.score,
    reasons: top.reasons
  };
}


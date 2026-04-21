import type { ModelDescriptor, ModelProvider } from "@opengravity/shared-types";

import type { ProviderChatMessage } from "./chat-state";
import {
  getPrimaryProviderAccount,
  getReadyProviderAccounts,
  isProviderReady,
  type ProviderAccount,
  type ProviderProfile,
  type WorkbenchSettings
} from "./settings-state";

export interface ParallelAgentTarget {
  account: ProviderAccount;
  modelId: string;
  provider: ModelProvider;
  roleLabel: string;
}

const compatibleProviders = new Set<ModelProvider>(["gemini", "groq", "openrouter", "openai", "custom"]);
const parallelRoleLabels = ["Architect", "Coder", "Reviewer", "Researcher", "Builder", "Tester"];

function isCompatibleProvider(provider: ModelProvider): boolean {
  return compatibleProviders.has(provider);
}

function resolveParallelModelId(
  profile: ProviderProfile,
  models: ModelDescriptor[],
  activeModelId: string,
  preferredProvider?: ModelProvider,
  preferredModelId?: string
): string {
  const providerModels = models.filter((model) => model.provider === profile.provider);
  if (profile.provider === preferredProvider && preferredModelId) {
    return preferredModelId;
  }

  if (providerModels.some((model) => model.id === activeModelId)) {
    return activeModelId;
  }

  if (providerModels.some((model) => model.id === profile.preferredModelId)) {
    return profile.preferredModelId;
  }

  return providerModels[0]?.id ?? profile.preferredModelId;
}

function rankProvider(profile: ProviderProfile, preferredProvider?: ModelProvider): number {
  if (profile.provider === preferredProvider) {
    return 0;
  }

  return profile.allowFallback ? 10 : 1000;
}

function getRoleDirective(roleLabel: string): string {
  switch (roleLabel) {
    case "Architect":
      return "Focus on system impact, hidden constraints, and the safest path through the change.";
    case "Coder":
      return "Focus on the most direct implementation path and concrete code-level decisions.";
    case "Reviewer":
      return "Focus on bugs, regressions, risky assumptions, and what could break after the change.";
    case "Researcher":
      return "Focus on alternatives, edge cases, hidden dependencies, and missing context.";
    case "Builder":
      return "Focus on build, toolchain, test, and execution details that keep the task moving.";
    case "Tester":
      return "Focus on validation, failure modes, reproduction steps, and regression coverage.";
    default:
      return "Focus on advancing the task with a distinct and useful perspective.";
  }
}

export function buildParallelAgentTargets(args: {
  activeModelId: string;
  maxCount: number;
  models: ModelDescriptor[];
  preferredModelId?: string;
  preferredProvider?: ModelProvider;
  settings: WorkbenchSettings;
}): ParallelAgentTarget[] {
  const { activeModelId, maxCount, models, preferredModelId, preferredProvider, settings } = args;
  const boundedCount = Math.max(1, Math.min(6, Math.trunc(maxCount)));
  const candidates: Array<ParallelAgentTarget & { score: number }> = [];

  for (const profile of settings.providerProfiles) {
    if (!isCompatibleProvider(profile.provider) || !isProviderReady(profile, settings)) {
      continue;
    }

    if (profile.provider !== preferredProvider && !profile.allowFallback) {
      continue;
    }

    const modelId = resolveParallelModelId(profile, models, activeModelId, preferredProvider, preferredModelId);
    if (!modelId) {
      continue;
    }

    const primaryAccountId = getPrimaryProviderAccount(settings, profile.provider)?.id ?? "";
    const readyAccounts = getReadyProviderAccounts(settings, profile.provider).sort((left, right) => {
      const leftPrimary = left.id === primaryAccountId ? 0 : 1;
      const rightPrimary = right.id === primaryAccountId ? 0 : 1;
      return leftPrimary - rightPrimary || left.label.localeCompare(right.label);
    });

    readyAccounts.forEach((account, index) => {
      candidates.push({
        account,
        modelId,
        provider: profile.provider,
        roleLabel: parallelRoleLabels[candidates.length % parallelRoleLabels.length] ?? `Agent ${candidates.length + 1}`,
        score: rankProvider(profile, preferredProvider) + index
      });
    });
  }

  return candidates
    .sort((left, right) => left.score - right.score || left.account.label.localeCompare(right.account.label))
    .slice(0, boundedCount)
    .map((candidate, index) => ({
      account: candidate.account,
      modelId: candidate.modelId,
      provider: candidate.provider,
      roleLabel: parallelRoleLabels[index] ?? `Agent ${index + 1}`
    }));
}

export function decorateMessagesForParallelTarget(
  messages: ProviderChatMessage[],
  target: ParallelAgentTarget,
  totalTargets: number
): ProviderChatMessage[] {
  const roleDirective = [
    `Parallel agent lane: ${target.roleLabel}.`,
    `This response is one of ${totalTargets} concurrent agent lanes.`,
    getRoleDirective(target.roleLabel)
  ].join(" ");

  const decoratedMessages = [...messages];
  const systemIndex = decoratedMessages.findIndex((message) => message.role === "system");

  if (systemIndex >= 0) {
    const systemMessage = decoratedMessages[systemIndex]!;
    decoratedMessages[systemIndex] = {
      ...systemMessage,
      content: `${systemMessage.content}\n\n${roleDirective}`
    };
    return decoratedMessages;
  }

  return [
    {
      role: "system",
      content: roleDirective
    },
    ...decoratedMessages
  ];
}

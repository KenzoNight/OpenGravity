import type { ChangedFile, ContinuityPack } from "@opengravity/shared-types";

export interface SessionSnapshot {
  title: string;
  currentGoal: string;
  executiveSummary: string;
  activeModelId: string;
  fallbackTrail: string[];
  branch?: string;
  worktree?: string;
  openBlockers: string[];
  pendingActions: string[];
  changedFiles: ChangedFile[];
  latestLogs: string[];
}

const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
};

const trimLogs = (logs: string[], maxEntries = 5): string[] => {
  return logs
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(-maxEntries);
};

export function buildContinuityPack(snapshot: SessionSnapshot): ContinuityPack {
  return {
    title: snapshot.title.trim(),
    currentGoal: snapshot.currentGoal.trim(),
    executiveSummary: snapshot.executiveSummary.trim(),
    activeModelId: snapshot.activeModelId.trim(),
    fallbackTrail: dedupe(snapshot.fallbackTrail),
    branch: snapshot.branch?.trim() || undefined,
    worktree: snapshot.worktree?.trim() || undefined,
    openBlockers: dedupe(snapshot.openBlockers),
    pendingActions: dedupe(snapshot.pendingActions),
    changedFiles: snapshot.changedFiles.filter((file) => file.path.trim() && file.summary.trim()),
    latestLogs: trimLogs(snapshot.latestLogs)
  };
}

export function summarizeProviderHandoff(pack: ContinuityPack): string {
  const lastTrail = pack.fallbackTrail.join(" -> ");
  const blockerText = pack.openBlockers.length > 0 ? pack.openBlockers.join("; ") : "none";

  return [
    `Goal: ${pack.currentGoal}`,
    `Active model: ${pack.activeModelId}`,
    `Fallback trail: ${lastTrail || "none"}`,
    `Pending actions: ${pack.pendingActions.join("; ") || "none"}`,
    `Open blockers: ${blockerText}`
  ].join(" | ");
}


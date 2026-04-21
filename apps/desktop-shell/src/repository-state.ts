export interface RepositorySnapshotPayload {
  available: boolean;
  workspaceRoot: string;
  repositoryRoot: string;
  branch: string;
  originUrl: string;
  statusLines: string[];
  recentCommitLines: string[];
}

export interface RepositoryChange {
  path: string;
  kind: "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted" | "unknown";
  staged: boolean;
  unstaged: boolean;
  summary: string;
  statusCode: string;
}

export interface RepositoryCommit {
  sha: string;
  shortSha: string;
  summary: string;
  relativeTime: string;
}

export interface GitHubRemote {
  host: string;
  owner: string;
  repo: string;
  url: string;
}

export interface RepositoryInsight {
  title: string;
  tone: "info" | "good" | "warn";
  detail: string;
}

export interface ParsedRepositorySnapshot {
  available: boolean;
  workspaceRoot: string;
  repositoryRoot: string;
  branch: string;
  originUrl: string;
  githubRemote: GitHubRemote | null;
  changes: RepositoryChange[];
  commits: RepositoryCommit[];
  trackingSummary: string;
  commitSuggestion: string;
  nextActions: string[];
  insights: RepositoryInsight[];
}

function normalizePathFromStatus(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.includes(" -> ")) {
    return trimmed.split(" -> ").pop()?.trim() ?? trimmed;
  }

  return trimmed;
}

function resolveChangeKind(code: string): RepositoryChange["kind"] {
  const [staged, unstaged] = code.padEnd(2, " ").slice(0, 2).split("");

  if (
    staged === "U" ||
    unstaged === "U" ||
    code === "AA" ||
    code === "DD" ||
    code === "AU" ||
    code === "UA" ||
    code === "DU" ||
    code === "UD"
  ) {
    return "conflicted";
  }

  if (code === "??") {
    return "untracked";
  }

  if (staged === "R" || unstaged === "R") {
    return "renamed";
  }

  if (staged === "C" || unstaged === "C") {
    return "copied";
  }

  if (staged === "A" || unstaged === "A") {
    return "added";
  }

  if (staged === "D" || unstaged === "D") {
    return "deleted";
  }

  if (staged === "M" || unstaged === "M") {
    return "modified";
  }

  return "unknown";
}

function summarizeChange(kind: RepositoryChange["kind"], staged: boolean, unstaged: boolean): string {
  const base =
    kind === "conflicted"
      ? "Conflict to resolve"
      : kind === "untracked"
        ? "Untracked file"
        : kind === "renamed"
          ? "Renamed file"
          : kind === "copied"
            ? "Copied file"
            : kind === "added"
              ? "Added file"
              : kind === "deleted"
                ? "Deleted file"
                : kind === "modified"
                  ? "Modified file"
                  : "Changed file";

  if (kind === "conflicted" || kind === "untracked") {
    return base;
  }

  if (staged && unstaged) {
    return `${base} with staged and unstaged edits`;
  }

  if (staged) {
    return `${base} staged for commit`;
  }

  if (unstaged) {
    return `${base} with local edits`;
  }

  return base;
}

export function parseGitStatusLine(line: string): RepositoryChange | null {
  if (!line || line.startsWith("##")) {
    return null;
  }

  const statusCode = line.slice(0, 2);
  const path = normalizePathFromStatus(line.slice(3));
  if (!path) {
    return null;
  }

  const staged = statusCode[0] !== " " && statusCode[0] !== "?";
  const unstaged = statusCode[1] !== " " && statusCode[1] !== "?";
  const kind = resolveChangeKind(statusCode);

  return {
    path,
    kind,
    staged,
    unstaged,
    summary: summarizeChange(kind, staged, unstaged),
    statusCode
  };
}

export function parseTrackingSummary(statusLines: string[]): string {
  const headline = statusLines.find((line) => line.startsWith("## "));
  if (!headline) {
    return "No upstream tracking info";
  }

  const trimmed = headline.slice(3).trim();
  if (!trimmed.includes("...")) {
    return trimmed;
  }

  const [branchPart, trackingPart] = trimmed.split("...");
  const suffix = trackingPart?.match(/\[(.+)\]/)?.[1];

  if (!suffix) {
    return `${branchPart} tracking ${trackingPart.replace(/\s*\[.+$/, "").trim()}`;
  }

  return `${branchPart} tracking ${trackingPart.replace(/\s*\[.+$/, "").trim()} · ${suffix}`;
}

export function parseRecentCommitLine(line: string): RepositoryCommit | null {
  const [sha, summary, relativeTime] = line.split("\t");
  if (!sha || !summary) {
    return null;
  }

  return {
    sha,
    shortSha: sha.slice(0, 7),
    summary: summary.trim(),
    relativeTime: (relativeTime ?? "").trim()
  };
}

export function parseGitHubRemote(originUrl: string): GitHubRemote | null {
  const trimmed = originUrl.trim();
  if (!trimmed) {
    return null;
  }

  const match =
    trimmed.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/i) ??
    trimmed.match(/^ssh:\/\/git@([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/i) ??
    trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/i);

  if (!match) {
    return null;
  }

  const [, host, owner, repo] = match;
  if (!host || !owner || !repo) {
    return null;
  }

  if (!host.toLowerCase().includes("github.com")) {
    return null;
  }

  return {
    host,
    owner,
    repo,
    url: `https://${host}/${owner}/${repo}`
  };
}

function detectThemes(changes: RepositoryChange[]): string[] {
  const paths = changes.map((change) => change.path.toLowerCase());
  const themes: string[] = [];

  if (paths.some((path) => path.includes("settings-state") || path.includes("openrouter-chat") || path.includes("shell-state"))) {
    themes.push("expand provider routing");
  }

  if (paths.some((path) => path.includes("repository-state") || path.includes("github") || path.includes("source-control"))) {
    themes.push("add repository radar");
  }

  if (paths.some((path) => path.includes("app.tsx") || path.includes("styles.css"))) {
    themes.push("refine the desktop workbench");
  }

  if (paths.some((path) => path.endsWith(".md"))) {
    themes.push("update the docs");
  }

  return themes;
}

export function suggestCommitMessage(changes: RepositoryChange[]): string {
  if (changes.length === 0) {
    return "chore(workspace): no local changes";
  }

  const paths = changes.map((change) => change.path.toLowerCase());
  const hasOnlyDocs = paths.every((path) => path.endsWith(".md"));
  const type = hasOnlyDocs ? "docs" : "feat";
  const scope = paths.some((path) => path.includes("src-tauri"))
    ? "desktop-shell"
    : paths.some((path) => path.includes("github") || path.includes("repository"))
      ? "source-control"
      : paths.some((path) => path.includes("settings-state") || path.includes("openrouter-chat"))
        ? "providers"
        : "workspace";
  const themes = detectThemes(changes);
  const summary = themes.length > 0 ? themes.slice(0, 2).join(" and ") : "ship the next desktop iteration";

  return `${type}(${scope}): ${summary}`;
}

function buildInsights(
  changes: RepositoryChange[],
  githubRemote: GitHubRemote | null,
  branch: string
): RepositoryInsight[] {
  const insights: RepositoryInsight[] = [];
  const conflicted = changes.filter((change) => change.kind === "conflicted").length;
  const untracked = changes.filter((change) => change.kind === "untracked").length;
  const touchedNative = changes.some((change) => change.path.includes("src-tauri/"));
  const touchedDependencies = changes.some(
    (change) => change.path.endsWith("package.json") || change.path.endsWith("package-lock.json")
  );
  const touchedProviderRouting = changes.some(
    (change) =>
      change.path.includes("settings-state") ||
      change.path.includes("openrouter-chat") ||
      change.path.includes("shell-state")
  );

  insights.push({
    title: "Branch focus",
    tone: "info",
    detail:
      changes.length === 0
        ? `${branch} is clean and ready for a new task.`
        : `${branch} has ${changes.length} local change${changes.length === 1 ? "" : "s"} to review before shipping.`
  });

  if (conflicted > 0) {
    insights.push({
      title: "Merge conflict risk",
      tone: "warn",
      detail: `${conflicted} file${conflicted === 1 ? "" : "s"} still need conflict resolution before a safe commit.`
    });
  } else if (untracked > 0) {
    insights.push({
      title: "Untracked files",
      tone: "warn",
      detail: `${untracked} new file${untracked === 1 ? "" : "s"} are not tracked yet. Decide whether they should ship or stay local.`
    });
  } else {
    insights.push({
      title: "Working tree",
      tone: "good",
      detail: "No merge conflicts detected in the current working tree."
    });
  }

  if (touchedNative) {
    insights.push({
      title: "Native bridge touched",
      tone: "warn",
      detail: "Rust bridge files changed, so cargo tests and an app health check should be part of the ship path."
    });
  } else if (touchedDependencies) {
    insights.push({
      title: "Dependency surface changed",
      tone: "warn",
      detail: "Package metadata changed, so the desktop shell should be rebuilt before release."
    });
  } else if (touchedProviderRouting) {
    insights.push({
      title: "Provider routing changed",
      tone: "info",
      detail: "Provider accounts, fallback routing, or model defaults changed. Verify ready-account selection after saving settings."
    });
  }

  if (githubRemote) {
    insights.push({
      title: "GitHub remote",
      tone: "good",
      detail: `Connected to ${githubRemote.owner}/${githubRemote.repo}. GitHub signals can be pulled without leaving the editor.`
    });
  }

  return insights.slice(0, 4);
}

function buildNextActions(changes: RepositoryChange[], githubRemote: GitHubRemote | null): string[] {
  const actions = new Set<string>();

  if (changes.some((change) => change.kind === "conflicted")) {
    actions.add("Resolve the remaining merge conflicts before running verification.");
  }

  if (changes.some((change) => change.path.includes("src-tauri/"))) {
    actions.add("Run cargo test --offline and npm run app:check before shipping.");
  }

  if (changes.some((change) => change.path.endsWith("package.json") || change.path.endsWith("package-lock.json"))) {
    actions.add("Rebuild the desktop shell to confirm dependency changes are healthy.");
  }

  if (changes.some((change) => change.kind === "untracked")) {
    actions.add("Review untracked files and decide whether they belong in the next commit.");
  }

  if (githubRemote) {
    actions.add("Refresh GitHub issues and pull requests before opening or updating a PR.");
  }

  if (actions.size === 0) {
    actions.add("Use the commit suggestion below and ship once the workflow panel is clean.");
  }

  return [...actions].slice(0, 4);
}

export function parseRepositorySnapshot(payload: RepositorySnapshotPayload): ParsedRepositorySnapshot {
  const changes = payload.statusLines
    .map((line) => parseGitStatusLine(line))
    .filter((entry): entry is RepositoryChange => Boolean(entry));
  const commits = payload.recentCommitLines
    .map((line) => parseRecentCommitLine(line))
    .filter((entry): entry is RepositoryCommit => Boolean(entry));
  const githubRemote = parseGitHubRemote(payload.originUrl);

  return {
    available: payload.available,
    workspaceRoot: payload.workspaceRoot,
    repositoryRoot: payload.repositoryRoot,
    branch: payload.branch || "detached",
    originUrl: payload.originUrl,
    githubRemote,
    changes,
    commits,
    trackingSummary: parseTrackingSummary(payload.statusLines),
    commitSuggestion: suggestCommitMessage(changes),
    nextActions: buildNextActions(changes, githubRemote),
    insights: buildInsights(changes, githubRemote, payload.branch || "detached")
  };
}

export const browserFallbackRepositorySnapshot: RepositorySnapshotPayload = {
  available: false,
  workspaceRoot: "browser-preview",
  repositoryRoot: "",
  branch: "preview",
  originUrl: "",
  statusLines: [],
  recentCommitLines: []
};

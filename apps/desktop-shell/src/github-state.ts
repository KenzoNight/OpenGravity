import type { GitHubRemote } from "./repository-state";

export interface GitHubWorkItem {
  number: number;
  title: string;
  url: string;
  author: string;
  updatedAt: string;
  state: string;
  kind: "pull" | "issue";
  isDraft?: boolean;
}

export interface GitHubRepositorySignals {
  fetchedAt: string;
  pulls: GitHubWorkItem[];
  issues: GitHubWorkItem[];
}

interface GitHubPullResponse {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  state: string;
  updated_at: string;
  user?: {
    login?: string;
  };
}

interface GitHubIssueResponse {
  number: number;
  title: string;
  html_url: string;
  state: string;
  updated_at: string;
  user?: {
    login?: string;
  };
  pull_request?: Record<string, unknown>;
}

function buildGitHubHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  return headers;
}

export async function fetchGitHubRepositorySignals(
  remote: GitHubRemote,
  token: string
): Promise<GitHubRepositorySignals> {
  const headers = buildGitHubHeaders(token);
  const repositoryPath = `repos/${remote.owner}/${remote.repo}`;
  const baseUrl = "https://api.github.com";

  const [pullsResponse, issuesResponse] = await Promise.all([
    fetch(`${baseUrl}/${repositoryPath}/pulls?state=open&per_page=5`, {
      headers,
      method: "GET"
    }),
    fetch(`${baseUrl}/${repositoryPath}/issues?state=open&per_page=8`, {
      headers,
      method: "GET"
    })
  ]);

  if (!pullsResponse.ok) {
    throw new Error(`GitHub pull request fetch failed with ${pullsResponse.status}.`);
  }

  if (!issuesResponse.ok) {
    throw new Error(`GitHub issue fetch failed with ${issuesResponse.status}.`);
  }

  const pullsPayload = (await pullsResponse.json()) as GitHubPullResponse[];
  const issuesPayload = (await issuesResponse.json()) as GitHubIssueResponse[];

  return {
    fetchedAt: new Date().toISOString(),
    pulls: pullsPayload.map((entry) => ({
      number: entry.number,
      title: entry.title,
      url: entry.html_url,
      author: entry.user?.login ?? "unknown",
      updatedAt: entry.updated_at,
      state: entry.state,
      kind: "pull",
      isDraft: Boolean(entry.draft)
    })),
    issues: issuesPayload
      .filter((entry) => !entry.pull_request)
      .map((entry) => ({
        number: entry.number,
        title: entry.title,
        url: entry.html_url,
        author: entry.user?.login ?? "unknown",
        updatedAt: entry.updated_at,
        state: entry.state,
        kind: "issue"
      }))
  };
}

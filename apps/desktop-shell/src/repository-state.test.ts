import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRepositoryRadar,
  parseGitHubRemote,
  parseGitStatusLine,
  parseRepositorySnapshot,
  suggestCommitMessage,
  type RepositorySnapshotPayload
} from "./repository-state.js";

describe("repository-state", () => {
  it("parses git status entries into structured change records", () => {
    const modified = parseGitStatusLine(" M apps/desktop-shell/src/App.tsx");
    const renamed = parseGitStatusLine("R  docs/old.md -> docs/new.md");
    const untracked = parseGitStatusLine("?? apps/desktop-shell/src/github-state.ts");

    assert.equal(modified?.kind, "modified");
    assert.equal(modified?.unstaged, true);
    assert.equal(renamed?.path, "docs/new.md");
    assert.equal(renamed?.kind, "renamed");
    assert.equal(untracked?.kind, "untracked");
  });

  it("recognizes common GitHub remote url formats", () => {
    assert.deepEqual(parseGitHubRemote("https://github.com/KenzoNight/OpenGravity.git"), {
      host: "github.com",
      owner: "KenzoNight",
      repo: "OpenGravity",
      url: "https://github.com/KenzoNight/OpenGravity"
    });

    assert.deepEqual(parseGitHubRemote("git@github.com:KenzoNight/OpenGravity.git"), {
      host: "github.com",
      owner: "KenzoNight",
      repo: "OpenGravity",
      url: "https://github.com/KenzoNight/OpenGravity"
    });
  });

  it("builds a repository radar summary with commit suggestions", () => {
    const payload: RepositorySnapshotPayload = {
      available: true,
      workspaceRoot: "C:/workspace/OpenGravity",
      repositoryRoot: "C:/workspace/OpenGravity",
      branch: "main",
      originUrl: "https://github.com/KenzoNight/OpenGravity.git",
      statusLines: [
        "## main...origin/main [ahead 2]",
        " M apps/desktop-shell/src/App.tsx",
        " M apps/desktop-shell/src/settings-state.ts",
        " M apps/desktop-shell/src-tauri/src/main.rs"
      ],
      recentCommitLines: [
        "1234567890abcdef\tAdd desktop workflow runner\t2 hours ago",
        "abcdef1234567890\tAdd Monaco editor integration\t3 hours ago"
      ]
    };

    const parsed = parseRepositorySnapshot(payload);

    assert.equal(parsed.available, true);
    assert.equal(parsed.githubRemote?.owner, "KenzoNight");
    assert.equal(parsed.changes.length, 3);
    assert.equal(parsed.commits[0]?.shortSha, "1234567");
    assert.match(parsed.commitSuggestion, /^feat\(/);
    assert.equal(parsed.radar.readiness, "review");
    assert.ok(parsed.nextActions.some((entry) => entry.includes("cargo test --offline")));
  });

  it("derives a provider-focused commit suggestion when provider files changed", () => {
    const suggestion = suggestCommitMessage([
      {
        path: "apps/desktop-shell/src/settings-state.ts",
        kind: "modified",
        staged: true,
        unstaged: false,
        summary: "Modified file staged for commit",
        statusCode: "M "
      }
    ]);

    assert.equal(suggestion, "feat(providers): expand provider routing");
  });

  it("marks blocked or ready commit states based on the working tree", () => {
    const blocked = buildRepositoryRadar(
      [
        {
          path: "apps/desktop-shell/src/App.tsx",
          kind: "conflicted",
          staged: false,
          unstaged: false,
          summary: "Conflict to resolve",
          statusCode: "UU"
        }
      ],
      "main"
    );
    const ready = buildRepositoryRadar(
      [
        {
          path: "apps/desktop-shell/src/App.tsx",
          kind: "modified",
          staged: true,
          unstaged: false,
          summary: "Modified file staged for commit",
          statusCode: "M "
        }
      ],
      "main"
    );

    assert.equal(blocked.readiness, "blocked");
    assert.equal(ready.readiness, "ready");
    assert.match(ready.summary, /ready for a commit/i);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySingleDocumentReplacement,
  buildWorkspaceCommandPresets,
  createWorkspaceDocument,
  createEditorTabList,
  filterWorkspaceFiles,
  getDirtyWorkspaceDocumentCount,
  getWorkspaceDocument,
  isDocumentDirty,
  labelForFilePath,
  markWorkspaceDocumentSaved,
  pickInitialWorkspaceFile,
  updateWorkspaceDocumentContent,
  upsertWorkspaceDocument
} from "./workspace-state.js";

describe("workspace-state", () => {
  it("picks a strong default file when known files exist", () => {
    const selected = pickInitialWorkspaceFile([
      "README.md",
      "apps/desktop-shell/src/App.tsx",
      "package.json"
    ]);

    assert.equal(selected, "apps/desktop-shell/src/App.tsx");
  });

  it("builds workspace-aware command presets", () => {
    const presets = buildWorkspaceCommandPresets(["package.json", "Cargo.toml", "pyproject.toml"]);
    const commands = presets.map((preset) => preset.command);

    assert.ok(commands.includes("npm run typecheck"));
    assert.ok(commands.includes("cargo check"));
    assert.ok(commands.includes("pytest"));
  });

  it("tracks dirty state and tab labels", () => {
    assert.equal(isDocumentDirty("a", "b"), true);
    assert.equal(isDocumentDirty("same", "same"), false);
    assert.deepEqual(
      createEditorTabList("apps/desktop-shell/src/App.tsx", ["build.log", "README.md", "build.log"]),
      ["apps/desktop-shell/src/App.tsx", "build.log", "README.md"]
    );
    assert.equal(labelForFilePath("apps/desktop-shell/src/App.tsx"), "App.tsx");
  });

  it("keeps multi-document state stable across edits", () => {
    const first = createWorkspaceDocument("README.md", "hello");
    const second = createWorkspaceDocument("package.json", "{}");
    const opened = upsertWorkspaceDocument([first], second);
    const edited = updateWorkspaceDocumentContent(opened, "README.md", "hello world");
    const saved = markWorkspaceDocumentSaved(edited, "README.md", "hello world");

    assert.equal(getWorkspaceDocument(edited, "README.md")?.currentContent, "hello world");
    assert.equal(getDirtyWorkspaceDocumentCount(edited), 1);
    assert.equal(getDirtyWorkspaceDocumentCount(saved), 0);
    assert.deepEqual(filterWorkspaceFiles(["README.md", "package.json"], "read"), ["README.md"]);
  });

  it("applies a replacement only when the target block is unique", () => {
    const applied = applySingleDocumentReplacement(
      "alpha\nbeta\ngamma\n",
      "beta\n",
      "beta-updated\n"
    );
    const ambiguous = applySingleDocumentReplacement("same\nsame\n", "same", "changed");
    const missing = applySingleDocumentReplacement("alpha", "beta", "gamma");

    assert.equal(applied.status, "applied");
    assert.equal(applied.status === "applied" ? applied.content : "", "alpha\nbeta-updated\ngamma\n");
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(missing.status, "not-found");
  });
});

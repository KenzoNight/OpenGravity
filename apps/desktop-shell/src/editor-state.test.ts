import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countDocumentLines, detectEditorLanguage, formatEditorLanguageLabel } from "./editor-state.js";

describe("editor-state", () => {
  it("detects common workspace file languages", () => {
    assert.equal(detectEditorLanguage("apps/desktop-shell/src/App.tsx"), "typescript");
    assert.equal(detectEditorLanguage("apps/desktop-shell/src-tauri/src/main.rs"), "rust");
    assert.equal(detectEditorLanguage("CMakeLists.txt"), "cmake");
    assert.equal(detectEditorLanguage("README.md"), "markdown");
    assert.equal(detectEditorLanguage("scripts/unknown.foobar"), "plaintext");
  });

  it("formats editor language labels for the workbench", () => {
    assert.equal(formatEditorLanguageLabel("cpp"), "C++");
    assert.equal(formatEditorLanguageLabel("typescript"), "TypeScript");
    assert.equal(formatEditorLanguageLabel("plaintext"), "Plain Text");
  });

  it("counts document lines for editor status", () => {
    assert.equal(countDocumentLines(""), 1);
    assert.equal(countDocumentLines("one line"), 1);
    assert.equal(countDocumentLines("first\nsecond\nthird"), 3);
  });
});

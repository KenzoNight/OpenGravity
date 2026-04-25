import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAgentEditPreview } from "./agent-edit-preview.js";

describe("agent-edit-preview", () => {
  it("builds a readable before and after summary for exact edits", () => {
    const preview = buildAgentEditPreview(
      "fn main() {\n  println!(\"hello\");\n}\n",
      "fn main() {\n  println!(\"hello world\");\n}\n"
    );

    assert.equal(preview.beforePreview, "fn main() {\n  println!(\"hello\");\n}\n");
    assert.equal(preview.afterPreview, "fn main() {\n  println!(\"hello world\");\n}\n");
    assert.equal(preview.beforeLineCount, 4);
    assert.equal(preview.afterLineCount, 4);
    assert.equal(preview.lineDelta, 0);
  });

  it("truncates very large edit previews", () => {
    const longBlock = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n");
    const preview = buildAgentEditPreview(longBlock, longBlock.replace("line-1", "updated-line-1"));

    assert.match(preview.beforePreview, /\.\.\.$/);
    assert.match(preview.afterPreview, /\.\.\.$/);
  });
});

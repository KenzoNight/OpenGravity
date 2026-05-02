import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractAgentActionPlan,
  normalizeAgentActionPlan
} from "./agent-action-state.js";

describe("agent-action-state", () => {
  it("extracts structured open, run, and edit actions from the assistant response", () => {
    const parsed = extractAgentActionPlan(`Inspect the failing build first.

\`\`\`opengravity-actions
{"summary":"Use the editor, tools, and terminal next","actions":[{"type":"open_file","path":"CMakeLists.txt"},{"type":"launch_skill","skillId":"skill-ghidra","label":"Launch Ghidra"},{"type":"run_command","command":"cmake --build build"},{"type":"replace_in_file","path":"src/main.rs","findText":"println!(\\\"hello\\\");","replaceText":"println!(\\\"hello world\\\");"}]}
\`\`\``);

    assert.match(parsed.cleanContent, /Inspect the failing build first/i);
    assert.equal(parsed.actionPlan?.actions.length, 4);
    assert.equal(parsed.actionPlan?.actions[0]?.type, "open_file");
    assert.equal(parsed.actionPlan?.actions[1]?.type, "launch_skill");
    assert.equal(parsed.actionPlan?.actions[1]?.skillId, "skill-ghidra");
    assert.equal(parsed.actionPlan?.actions[2]?.type, "run_command");
    assert.equal(parsed.actionPlan?.actions[3]?.type, "replace_in_file");
    assert.equal(parsed.actionPlan?.actions[3]?.replaceText, 'println!("hello world");');
  });

  it("rejects invalid or incomplete action payloads", () => {
    const plan = normalizeAgentActionPlan({
      summary: "Broken plan",
      actions: [
        { type: "open_file" },
        { type: "replace_in_file", path: "src/main.rs" },
        { type: "run_workflow", workflow: "recommended" }
      ]
    });

    assert.equal(plan?.actions.length, 1);
    assert.equal(plan?.actions[0]?.type, "run_workflow");
  });

  it("keeps empty replacement text so deletions can be expressed safely", () => {
    const plan = normalizeAgentActionPlan({
      summary: "Delete a redundant line",
      actions: [
        {
          type: "replace_in_file",
          path: "src/main.rs",
          findText: "println!(\"debug\");\n",
          replaceText: ""
        }
      ]
    });

    assert.equal(plan?.actions[0]?.type, "replace_in_file");
    assert.equal(plan?.actions[0]?.replaceText, "");
  });
});


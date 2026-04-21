import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractAgentActionPlan,
  normalizeAgentActionPlan
} from "./agent-action-state.js";

describe("agent-action-state", () => {
  it("extracts a structured action plan from the assistant response", () => {
    const parsed = extractAgentActionPlan(`Inspect the failing build first.

\`\`\`opengravity-actions
{"summary":"Use the editor and terminal next","actions":[{"type":"open_file","path":"CMakeLists.txt"},{"type":"run_command","command":"cmake --build build"}]}
\`\`\``);

    assert.match(parsed.cleanContent, /Inspect the failing build first/i);
    assert.equal(parsed.actionPlan?.actions.length, 2);
    assert.equal(parsed.actionPlan?.actions[0]?.type, "open_file");
    assert.equal(parsed.actionPlan?.actions[1]?.type, "run_command");
  });

  it("rejects invalid or incomplete action payloads", () => {
    const plan = normalizeAgentActionPlan({
      summary: "Broken plan",
      actions: [
        { type: "open_file" },
        { type: "run_workflow", workflow: "recommended" }
      ]
    });

    assert.equal(plan?.actions.length, 1);
    assert.equal(plan?.actions[0]?.type, "run_workflow");
  });
});

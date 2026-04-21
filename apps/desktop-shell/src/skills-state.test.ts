import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addLocalSkill,
  normalizeLocalSkills,
  parseSkillArguments,
  removeLocalSkill,
  serializeLocalSkills,
  updateLocalSkill
} from "./skills-state.js";

describe("skills-state", () => {
  it("creates and updates local skills without hardcoded tools", () => {
    const created = addLocalSkill([]);
    const skill = created[0];
    const updated = updateLocalSkill(created, skill.id, {
      label: "Ghidra",
      executablePath: "C:/Tools/Ghidra/ghidraRun.bat",
      workingDirectory: "C:/Tools/Ghidra",
      argumentsText: "project.gpr\nscript.py"
    });

    assert.equal(updated[0]?.label, "Ghidra");
    assert.deepEqual(parseSkillArguments(updated[0]!), ["project.gpr", "script.py"]);
    assert.equal(removeLocalSkill(updated, skill.id).length, 0);
  });

  it("normalizes persisted skill payloads", () => {
    const normalized = normalizeLocalSkills([
      {
        id: "skill-9",
        label: "x64dbg",
        enabled: false,
        executablePath: "C:/Tools/x64dbg/x64dbg.exe"
      }
    ]);

    assert.equal(normalized[0]?.enabled, false);
    assert.equal(
      serializeLocalSkills(normalized),
      JSON.stringify(normalized)
    );
  });
});

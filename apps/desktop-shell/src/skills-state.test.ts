import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addLocalSkill,
  createLocalSkillFromTemplate,
  getStarterSkillTemplates,
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
      executablePath: "/opt/tooling/ghidra/launcher",
      workingDirectory: "/opt/tooling/ghidra",
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
        executablePath: "/opt/tooling/x64dbg/launcher"
      }
    ]);

    assert.equal(normalized[0]?.enabled, false);
    assert.equal(
      serializeLocalSkills(normalized),
      JSON.stringify(normalized)
    );
  });

  it("provides generic starter templates without machine-specific paths", () => {
    const templates = getStarterSkillTemplates();
    const ghidraTemplate = templates.find((template) => template.id === "ghidra");
    const created = ghidraTemplate ? createLocalSkillFromTemplate(ghidraTemplate) : null;

    assert.ok(ghidraTemplate);
    assert.equal(ghidraTemplate?.executablePath, "ghidraRun.bat");
    assert.ok(created);
    assert.equal(created?.label, "Ghidra");
    assert.equal(created?.workingDirectory, "");
  });
});

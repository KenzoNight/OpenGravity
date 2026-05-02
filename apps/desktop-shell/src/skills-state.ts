export const skillsStorageKey = "opengravity.local-skills.v1";

export interface LocalSkill {
  id: string;
  label: string;
  description: string;
  executablePath: string;
  workingDirectory: string;
  argumentsText: string;
  enabled: boolean;
}

export interface LocalSkillTemplate {
  id: string;
  label: string;
  description: string;
  executablePath: string;
  argumentsText: string;
}

let nextSkillId = 1;

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const starterSkillTemplates: LocalSkillTemplate[] = [
  {
    id: "ghidra",
    label: "Ghidra",
    description: "Reverse engineering suite for static analysis, decompilation, and scriptable program inspection.",
    executablePath: "ghidraRun.bat",
    argumentsText: ""
  },
  {
    id: "x64dbg",
    label: "x64dbg",
    description: "User-mode debugger for tracing binaries, inspecting registers, and stepping through runtime behavior.",
    executablePath: "x64dbg.exe",
    argumentsText: ""
  },
  {
    id: "windbg",
    label: "WinDbg",
    description: "Windows debugger for user-mode and kernel debugging, crash dump analysis, and symbol-heavy inspection.",
    executablePath: "windbg.exe",
    argumentsText: ""
  }
];

export function createDefaultSkills(): LocalSkill[] {
  return [];
}

export function createLocalSkill(index = nextSkillId++): LocalSkill {
  return {
    id: `skill-${index}`,
    label: `Tool ${index}`,
    description: "",
    executablePath: "",
    workingDirectory: "",
    argumentsText: "",
    enabled: true
  };
}

export function getStarterSkillTemplates(): LocalSkillTemplate[] {
  return starterSkillTemplates.map((template) => ({ ...template }));
}

export function createLocalSkillFromTemplate(template: LocalSkillTemplate): LocalSkill {
  const skill = createLocalSkill();
  return {
    ...skill,
    label: template.label,
    description: template.description,
    executablePath: template.executablePath,
    argumentsText: template.argumentsText
  };
}

export function normalizeLocalSkills(input: unknown): LocalSkill[] {
  if (!Array.isArray(input)) {
    return createDefaultSkills();
  }

  const skills = input
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const value = entry as Partial<LocalSkill>;
      return {
        id: normalizeString(value.id) || `skill-${index + 1}`,
        label: normalizeString(value.label) || `Tool ${index + 1}`,
        description: normalizeString(value.description),
        executablePath: normalizeString(value.executablePath),
        workingDirectory: normalizeString(value.workingDirectory),
        argumentsText: normalizeString(value.argumentsText),
        enabled: typeof value.enabled === "boolean" ? value.enabled : true
      } satisfies LocalSkill;
    });

  nextSkillId = Math.max(
    nextSkillId,
    skills.reduce((current, skill) => {
      const match = /skill-(\d+)/.exec(skill.id);
      const numericId = match ? Number.parseInt(match[1] ?? "", 10) : 0;
      return Number.isFinite(numericId) ? Math.max(current, numericId + 1) : current;
    }, 1)
  );

  return skills;
}

export function serializeLocalSkills(skills: LocalSkill[]): string {
  return JSON.stringify(skills);
}

export function addLocalSkill(skills: LocalSkill[]): LocalSkill[] {
  return [...skills, createLocalSkill()];
}

export function updateLocalSkill(
  skills: LocalSkill[],
  skillId: string,
  patch: Partial<Omit<LocalSkill, "id">>
): LocalSkill[] {
  return skills.map((skill) =>
    skill.id === skillId
      ? {
          ...skill,
          ...patch
        }
      : skill
  );
}

export function removeLocalSkill(skills: LocalSkill[], skillId: string): LocalSkill[] {
  return skills.filter((skill) => skill.id !== skillId);
}

export function parseSkillArguments(skill: LocalSkill): string[] {
  return skill.argumentsText
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

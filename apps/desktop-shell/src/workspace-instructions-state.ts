export interface WorkspaceInstructionsSnapshot {
  path: string;
  content: string;
}

const workspaceInstructionPromptLimit = 6000;

function trimInstructionContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= workspaceInstructionPromptLimit) {
    return trimmed;
  }

  return `${trimmed.slice(0, workspaceInstructionPromptLimit).trimEnd()}\n...`;
}

export function normalizeWorkspaceInstructions(
  path: string,
  content: string
): WorkspaceInstructionsSnapshot | null {
  const normalizedPath = path.trim();
  const normalizedContent = trimInstructionContent(content);

  if (!normalizedPath || !normalizedContent) {
    return null;
  }

  return {
    path: normalizedPath,
    content: normalizedContent
  };
}

export function buildWorkspaceInstructionsPrompt(
  instructions: WorkspaceInstructionsSnapshot | null
): string | null {
  if (!instructions) {
    return null;
  }

  return `Workspace instructions from ${instructions.path}:\n${instructions.content}`;
}

export function getWorkspaceInstructionsStatus(
  instructions: WorkspaceInstructionsSnapshot | null
): string {
  if (!instructions) {
    return "No workspace instructions loaded";
  }

  return `${instructions.path} loaded`;
}

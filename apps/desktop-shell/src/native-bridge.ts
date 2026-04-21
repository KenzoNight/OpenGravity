export interface WorkspaceSnapshotPayload {
  rootPath: string;
  files: string[];
  activeFilePath: string;
  activeFileContent: string;
}

export interface WorkspaceFilePayload {
  path: string;
  content: string;
}

export interface WorkspaceCommandResult {
  command: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface WorkspaceCommandStarted {
  runId: string;
  command: string;
}

export interface WorkspaceCommandEventPayload {
  runId: string;
  command: string;
  kind: "started" | "stdout" | "stderr" | "completed" | "cancelled" | "launch-failed";
  line?: string;
  success?: boolean;
  exitCode?: number;
  durationMs?: number;
  message?: string;
}

const browserFallbackFile = "apps/desktop-shell/src/App.tsx";

const browserFallbackContent = `export default function App() {
  return "OpenGravity browser preview";
}
`;

export const browserFallbackWorkspace: WorkspaceSnapshotPayload = {
  rootPath: "browser-preview",
  files: [
    "README.md",
    "package.json",
    "apps/desktop-shell/src/App.tsx",
    "apps/desktop-shell/src/settings-state.ts"
  ],
  activeFilePath: browserFallbackFile,
  activeFileContent: browserFallbackContent
};

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshotPayload> {
  try {
    return await invokeCommand<WorkspaceSnapshotPayload>("workspace_snapshot");
  } catch {
    return browserFallbackWorkspace;
  }
}

export async function readWorkspaceFile(relativePath: string): Promise<WorkspaceFilePayload> {
  try {
    return await invokeCommand<WorkspaceFilePayload>("read_workspace_file", { relativePath });
  } catch {
    return {
      path: relativePath,
      content: browserFallbackWorkspace.activeFileContent
    };
  }
}

export async function writeWorkspaceFile(relativePath: string, content: string): Promise<WorkspaceFilePayload> {
  try {
    return await invokeCommand<WorkspaceFilePayload>("write_workspace_file", { relativePath, content });
  } catch {
    return {
      path: relativePath,
      content
    };
  }
}

export async function runWorkspaceCommand(command: string): Promise<WorkspaceCommandResult> {
  try {
    return await invokeCommand<WorkspaceCommandResult>("run_workspace_command", { command });
  } catch {
    return {
      command,
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "Native command execution is unavailable in browser preview mode.",
      durationMs: 0
    };
  }
}

export async function startWorkspaceCommand(command: string): Promise<WorkspaceCommandStarted> {
  return invokeCommand<WorkspaceCommandStarted>("start_workspace_command", { command });
}

export async function cancelWorkspaceCommand(runId: string): Promise<boolean> {
  return invokeCommand<boolean>("cancel_workspace_command", { runId });
}

export async function listenToWorkspaceCommands(
  callback: (payload: WorkspaceCommandEventPayload) => void
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<WorkspaceCommandEventPayload>("workspace-command", (event) => {
      callback(event.payload);
    });
    return unlisten;
  } catch {
    return () => {};
  }
}

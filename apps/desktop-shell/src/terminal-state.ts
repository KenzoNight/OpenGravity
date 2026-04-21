import type {
  WorkspaceCommandEventPayload,
  WorkspaceCommandResult,
  WorkspaceCommandStarted
} from "./native-bridge";

export type TerminalSessionStatus = "running" | "completed" | "failed" | "cancelled";

export interface TerminalSession {
  runId: string;
  command: string;
  status: TerminalSessionStatus;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs?: number;
  message?: string;
}

function appendTerminalLine(existing: string, nextLine?: string): string {
  if (!nextLine) {
    return existing;
  }

  return existing ? `${existing}\n${nextLine}` : nextLine;
}

export function formatCommandSummary(
  session: Pick<TerminalSession, "status" | "exitCode" | "durationMs">
): string {
  const durationLabel = typeof session.durationMs === "number" ? ` · ${session.durationMs} ms` : "";

  switch (session.status) {
    case "running":
      return "Running";
    case "completed":
      return `Exit ${session.exitCode ?? 0}${durationLabel}`;
    case "cancelled":
      return `Cancelled (${session.exitCode ?? -1})${durationLabel}`;
    case "failed":
      return `Failed (${session.exitCode ?? -1})${durationLabel}`;
  }
}

export function createTerminalSession(started: WorkspaceCommandStarted): TerminalSession {
  return {
    runId: started.runId,
    command: started.command,
    status: "running",
    stdout: "",
    stderr: ""
  };
}

export function createTerminalSessionFromResult(result: WorkspaceCommandResult): TerminalSession {
  return {
    runId: `fallback-${Date.now()}`,
    command: result.command,
    status: result.success ? "completed" : "failed",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs
  };
}

export function appendTerminalSession(
  sessions: TerminalSession[],
  session: TerminalSession,
  limit = 12
): TerminalSession[] {
  return [session, ...sessions.filter((entry) => entry.runId !== session.runId)].slice(0, limit);
}

export function applyWorkspaceCommandEvent(
  sessions: TerminalSession[],
  payload: WorkspaceCommandEventPayload
): TerminalSession[] {
  return sessions.map((session) => {
    if (session.runId !== payload.runId) {
      return session;
    }

    if (payload.kind === "stdout") {
      return {
        ...session,
        stdout: appendTerminalLine(session.stdout, payload.line)
      };
    }

    if (payload.kind === "stderr") {
      return {
        ...session,
        stderr: appendTerminalLine(session.stderr, payload.line)
      };
    }

    if (payload.kind === "cancelled") {
      return {
        ...session,
        status: "cancelled",
        exitCode: payload.exitCode,
        durationMs: payload.durationMs,
        message: payload.message
      };
    }

    if (payload.kind === "completed") {
      return {
        ...session,
        status: payload.success ? "completed" : "failed",
        exitCode: payload.exitCode,
        durationMs: payload.durationMs,
        message: payload.message
      };
    }

    if (payload.kind === "launch-failed") {
      return {
        ...session,
        status: "failed",
        stderr: appendTerminalLine(session.stderr, payload.message),
        exitCode: payload.exitCode,
        durationMs: payload.durationMs,
        message: payload.message
      };
    }

    return session;
  });
}

export function resolveSelectedTerminalRunId(
  sessions: TerminalSession[],
  currentSelectedRunId: string | null,
  activeRunId: string | null
): string | null {
  if (activeRunId && sessions.some((session) => session.runId === activeRunId)) {
    return activeRunId;
  }

  if (currentSelectedRunId && sessions.some((session) => session.runId === currentSelectedRunId)) {
    return currentSelectedRunId;
  }

  return sessions[0]?.runId ?? null;
}

export function buildTerminalTranscript(session: TerminalSession): string {
  const chunks = [`$ ${session.command}`];

  if (session.message) {
    chunks.push(`[status] ${session.message}`);
  }

  if (session.stdout) {
    chunks.push(session.stdout.trimEnd());
  }

  if (session.stderr) {
    chunks.push("[stderr]");
    chunks.push(session.stderr.trimEnd());
  }

  return `${chunks.filter(Boolean).join("\n\n")}\n`;
}

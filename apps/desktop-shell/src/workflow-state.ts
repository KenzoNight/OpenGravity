import type {
  ExecutionStep,
  WorkspaceExecutionPlan
} from "@opengravity/build-intelligence";

import type { WorkspaceCommandEventPayload, WorkspaceCommandResult } from "./native-bridge";

export type WorkflowItemStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type WorkflowRunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export interface WorkflowItem {
  id: string;
  label: string;
  kind: ExecutionStep["kind"];
  command: string;
  status: WorkflowItemStatus;
  runId?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface WorkflowRun {
  id: string;
  status: WorkflowRunStatus;
  currentRunId: string | null;
  items: WorkflowItem[];
}

let nextWorkflowId = 1;

function updateWorkflowItem(
  item: WorkflowItem,
  status: WorkflowItemStatus,
  patch: Partial<Omit<WorkflowItem, "id" | "label" | "kind" | "command" | "status">> = {}
): WorkflowItem {
  return {
    ...item,
    ...patch,
    status
  };
}

function cancelQueuedWorkflowItems(items: WorkflowItem[]): WorkflowItem[] {
  return items.map((item): WorkflowItem =>
    item.status === "queued" ? updateWorkflowItem(item, "cancelled") : item
  );
}

export function createWorkflowRun(
  plan: WorkspaceExecutionPlan,
  initialStatus: WorkflowRunStatus = "idle"
): WorkflowRun {
  const items = plan.steps.flatMap((step, stepIndex) =>
    step.commands.map((command, commandIndex) => ({
      id: `wf-item-${stepIndex}-${commandIndex}`,
      label: step.commands.length > 1 ? `${step.label} ${commandIndex + 1}` : step.label,
      kind: step.kind,
      command,
      status: "queued" as const
    }))
  );

  return {
    id: `wf-${nextWorkflowId++}`,
    status: initialStatus,
    currentRunId: null,
    items
  };
}

export function getNextQueuedWorkflowItem(run: WorkflowRun): WorkflowItem | undefined {
  return run.items.find((item) => item.status === "queued");
}

export function markWorkflowItemRunning(run: WorkflowRun, itemId: string, runId: string): WorkflowRun {
  return {
    ...run,
    currentRunId: runId,
    items: run.items.map((item): WorkflowItem =>
      item.id === itemId
        ? updateWorkflowItem(item, "running", { runId })
        : item
    )
  };
}

export function cancelWorkflowRun(run: WorkflowRun): WorkflowRun {
  if (run.status === "cancelled") {
    return run;
  }

  return {
    ...run,
    status: "cancelled",
    items: run.currentRunId ? run.items : cancelQueuedWorkflowItems(run.items)
  };
}

export function applyWorkflowCommandResult(
  run: WorkflowRun,
  itemId: string,
  result: WorkspaceCommandResult
): WorkflowRun {
  const nextStatus: WorkflowItemStatus = result.success ? "completed" : "failed";
  const items: WorkflowItem[] = run.items.map((item): WorkflowItem =>
    item.id === itemId
      ? updateWorkflowItem(item, nextStatus, {
          exitCode: result.exitCode,
          durationMs: result.durationMs
        })
      : item
  );

  if (run.status === "cancelled") {
    return {
      ...run,
      currentRunId: null,
      items: cancelQueuedWorkflowItems(items)
    };
  }

  if (!result.success) {
    return {
      ...run,
      status: "failed",
      currentRunId: null,
      items
    };
  }

  const hasQueuedItems = items.some((item) => item.status === "queued");
  return {
    ...run,
    status: hasQueuedItems ? "running" : "completed",
    currentRunId: null,
    items
  };
}

export function applyWorkflowEvent(run: WorkflowRun, payload: WorkspaceCommandEventPayload): WorkflowRun {
  const currentItem = run.items.find((item) => item.runId === payload.runId);
  if (!currentItem) {
    return run;
  }

  if (payload.kind === "stdout" || payload.kind === "stderr" || payload.kind === "started") {
    return run;
  }

  const nextStatus: WorkflowItemStatus =
    payload.kind === "cancelled"
      ? "cancelled"
      : payload.kind === "completed"
        ? payload.success
          ? "completed"
          : "failed"
        : "failed";

  const items: WorkflowItem[] = run.items.map((item): WorkflowItem =>
    item.runId === payload.runId
      ? updateWorkflowItem(item, nextStatus, {
          exitCode: payload.exitCode,
          durationMs: payload.durationMs
        })
      : item
  );

  if (run.status === "cancelled" || nextStatus === "cancelled") {
    return {
      ...run,
      status: "cancelled",
      currentRunId: null,
      items: cancelQueuedWorkflowItems(items)
    };
  }

  if (nextStatus === "failed") {
    return {
      ...run,
      status: "failed",
      currentRunId: null,
      items
    };
  }

  const hasQueuedItems = items.some((item) => item.status === "queued");
  return {
    ...run,
    status: hasQueuedItems ? "running" : "completed",
    currentRunId: null,
    items
  };
}

export function getWorkflowProgress(run: WorkflowRun): { completed: number; total: number } {
  return {
    completed: run.items.filter((item) => item.status === "completed").length,
    total: run.items.length
  };
}

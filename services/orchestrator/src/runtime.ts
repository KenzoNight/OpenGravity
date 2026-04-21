import type { ArtifactRecord, ModelDescriptor, ProviderHealth, TaskNode, TaskStatus } from "@opengravity/shared-types";
import type { RoutingRequest } from "@opengravity/model-router";
import type { SessionSnapshot } from "@opengravity/session-core";

import {
  InMemorySessionStore,
  allocateAgent,
  createAgentRegistry,
  createTaskGraph,
  getRunnableTasks,
  planProviderHandoff,
  releaseAgent,
  updateTaskStatus,
  type AgentRegistry,
  type ProviderHandoffPlan,
  type SessionLedgerStore,
  type TaskGraph
} from "./core.js";

export interface TaskAssignment {
  taskId: string;
  agentId: string;
}

export interface OrchestratorRuntimeSnapshot {
  graph: TaskGraph;
  registry: AgentRegistry;
}

const releasableStates = new Set<TaskStatus>(["completed", "failed", "blocked", "cancelled"]);

export class InMemoryOrchestratorRuntime {
  private graph: TaskGraph;
  private registry: AgentRegistry;
  private activeSessionId?: string;

  readonly sessionStore: SessionLedgerStore;

  constructor(input: {
    graph: TaskNode[];
    agents: Parameters<typeof createAgentRegistry>[0];
    sessionStore?: SessionLedgerStore;
  }) {
    this.graph = createTaskGraph(input.graph);
    this.registry = createAgentRegistry(input.agents);
    this.sessionStore = input.sessionStore ?? new InMemorySessionStore();
  }

  seedSession(sessionId: string, snapshot: SessionSnapshot): void {
    this.activeSessionId = sessionId;
    this.sessionStore.save(sessionId, snapshot);
    this.sessionStore.appendEvent(sessionId, {
      type: "session_seeded",
      message: `Seeded session '${snapshot.title}' with active model ${snapshot.activeModelId}.`,
      modelId: snapshot.activeModelId,
      metadata: {
        pendingActions: snapshot.pendingActions.length,
        blockers: snapshot.openBlockers.length
      }
    });
  }

  getSnapshot(): OrchestratorRuntimeSnapshot {
    return {
      graph: {
        tasks: this.graph.tasks.map((task) => ({ ...task, dependsOn: [...task.dependsOn] }))
      },
      registry: {
        agents: this.registry.agents.map((agent) => ({
          ...agent,
          supportedTaskTypes: [...agent.supportedTaskTypes]
        }))
      }
    };
  }

  dispatchNextTasks(): TaskAssignment[] {
    const runnable = getRunnableTasks(this.graph);
    const assignments: TaskAssignment[] = [];

    for (const task of runnable) {
      try {
        const allocation = allocateAgent(this.registry, task.requiredRole, task.id);
        this.registry = allocation.registry;
        this.graph = {
          tasks: this.graph.tasks.map((node) =>
            node.id === task.id
              ? {
                  ...node,
                  status: "running",
                  assignedAgentId: allocation.agent.id,
                  blockerReason: undefined
                }
              : node
          )
        };
        assignments.push({ taskId: task.id, agentId: allocation.agent.id });
        this.appendRuntimeEvent({
          type: "agent_allocated",
          message: `Allocated agent ${allocation.agent.id} to task ${task.id}.`,
          taskId: task.id,
          agentId: allocation.agent.id
        });
        this.appendRuntimeEvent({
          type: "task_dispatched",
          message: `Dispatched task ${task.id} to ${allocation.agent.id}.`,
          taskId: task.id,
          agentId: allocation.agent.id
        });
      } catch {
        continue;
      }
    }

    return assignments;
  }

  transitionTask(taskId: string, status: TaskStatus, blockerReason?: string): void {
    const task = this.graph.tasks.find((node) => node.id === taskId);
    if (!task) {
      throw new Error(`Unknown task id: ${taskId}`);
    }

    this.graph = updateTaskStatus(this.graph, taskId, status, blockerReason);

    if (releasableStates.has(status) && task.assignedAgentId) {
      this.registry = releaseAgent(this.registry, task.assignedAgentId);
      this.graph = {
        tasks: this.graph.tasks.map((node) =>
          node.id === taskId ? { ...node, assignedAgentId: undefined } : node
        )
      };
      this.appendRuntimeEvent({
        type: "agent_released",
        message: `Released agent ${task.assignedAgentId} from task ${taskId}.`,
        taskId,
        agentId: task.assignedAgentId
      });
    }

    this.appendRuntimeEvent({
      type: "task_transitioned",
      message: blockerReason?.trim()
        ? `Task ${taskId} transitioned to ${status}: ${blockerReason.trim()}`
        : `Task ${taskId} transitioned to ${status}.`,
      taskId,
      agentId: task.assignedAgentId,
      metadata: blockerReason ? { blockerReason: blockerReason.trim() } : undefined
    });
  }

  planHandoff(input: {
    sessionId: string;
    request: RoutingRequest;
    models: ModelDescriptor[];
    providerHealth: ProviderHealth[];
  }): ProviderHandoffPlan {
    const plan = planProviderHandoff({
      sessionId: input.sessionId,
      continuityStore: this.sessionStore,
      request: input.request,
      models: input.models,
      providerHealth: input.providerHealth
    });

    this.sessionStore.appendEvent(input.sessionId, {
      type: "provider_handoff_planned",
      message: `Planned provider handoff to ${plan.nextModel.id}.`,
      modelId: plan.nextModel.id,
      metadata: {
        score: plan.score,
        reasons: plan.reasons
      }
    });
    this.sessionStore.addArtifact(input.sessionId, {
      kind: "continuity-pack",
      title: `Continuity Pack -> ${plan.nextModel.label}`,
      contentSummary: plan.continuitySummary,
      metadata: {
        fallbackTrail: plan.continuityPack.fallbackTrail,
        pendingActions: plan.continuityPack.pendingActions
      }
    });

    return plan;
  }

  recordArtifact(input: {
    kind: ArtifactRecord["kind"];
    title: string;
    contentSummary: string;
    taskId?: string;
    path?: string;
    metadata?: Record<string, string | number | boolean | string[]>;
  }): ArtifactRecord {
    const sessionId = this.requireActiveSessionId();
    const artifact = this.sessionStore.addArtifact(sessionId, input);
    this.sessionStore.appendEvent(sessionId, {
      type: "artifact_recorded",
      message: `Recorded artifact '${artifact.title}' (${artifact.kind}).`,
      taskId: input.taskId,
      metadata: {
        artifactId: artifact.id,
        kind: artifact.kind
      }
    });
    return artifact;
  }

  getSessionRecord(sessionId?: string) {
    return this.sessionStore.getRecord(sessionId ?? this.requireActiveSessionId());
  }

  private appendRuntimeEvent(input: {
    type: "agent_allocated" | "task_dispatched" | "task_transitioned" | "agent_released";
    message: string;
    taskId?: string;
    agentId?: string;
    metadata?: Record<string, string | number | boolean>;
  }): void {
    if (!this.activeSessionId) {
      return;
    }

    this.sessionStore.appendEvent(this.activeSessionId, input);
  }

  private requireActiveSessionId(): string {
    if (!this.activeSessionId) {
      throw new Error("No active session has been seeded for this runtime.");
    }

    return this.activeSessionId;
  }
}

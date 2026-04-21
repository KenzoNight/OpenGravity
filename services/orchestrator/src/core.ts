import { selectNextModel, type RoutedCandidate, type RoutingRequest } from "@opengravity/model-router";
import {
  buildContinuityPack,
  summarizeProviderHandoff,
  type SessionSnapshot
} from "@opengravity/session-core";
import type {
  AgentDescriptor,
  ArtifactKind,
  ArtifactRecord,
  AgentRole,
  JsonValue,
  ModelDescriptor,
  ProviderHealth,
  ProviderHealthState,
  SessionEvent,
  SessionEventType,
  TaskNode,
  TaskStatus
} from "@opengravity/shared-types";

export interface TaskGraph {
  tasks: TaskNode[];
}

export interface AgentRegistry {
  agents: AgentDescriptor[];
}

export interface ContinuityRecord {
  sessionId: string;
  snapshot: SessionSnapshot;
}

export interface PersistedSessionRecord {
  sessionId: string;
  snapshot?: SessionSnapshot;
  events: SessionEvent[];
  artifacts: ArtifactRecord[];
}

export interface ContinuitySnapshotStore {
  save(sessionId: string, snapshot: SessionSnapshot): void;
  get(sessionId: string): SessionSnapshot | undefined;
}

export interface ProviderHandoffPlan {
  nextModel: ModelDescriptor;
  continuitySummary: string;
  continuityPack: ReturnType<typeof buildContinuityPack>;
  score: number;
  reasons: string[];
}

const terminalStates = new Set<TaskStatus>(["completed", "failed", "cancelled"]);

const providerAvailability: Record<ProviderHealthState, boolean> = {
  healthy: true,
  degraded: true,
  rate_limited: false,
  offline: false
};

const cloneRecord = (record: PersistedSessionRecord): PersistedSessionRecord => structuredClone(record);

const emptyRecord = (sessionId: string): PersistedSessionRecord => ({
  sessionId,
  events: [],
  artifacts: []
});

function createRecordId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const randomUuid = cryptoApi?.randomUUID;
  if (randomUuid) {
    return randomUuid.call(cryptoApi);
  }

  return `og-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTaskGraph(tasks: TaskNode[]): TaskGraph {
  const seen = new Set<string>();
  const taskIds = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`);
    }
    seen.add(task.id);

    for (const dependency of task.dependsOn) {
      if (!taskIds.has(dependency)) {
        throw new Error(`Task ${task.id} depends on missing task ${dependency}`);
      }
    }
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const visit = (taskId: string): void => {
    if (active.has(taskId)) {
      throw new Error(`Cycle detected at task ${taskId}`);
    }
    if (visited.has(taskId)) {
      return;
    }

    active.add(taskId);
    const task = byId.get(taskId);
    if (!task) {
      throw new Error(`Task not found during cycle detection: ${taskId}`);
    }

    for (const dependency of task.dependsOn) {
      visit(dependency);
    }

    active.delete(taskId);
    visited.add(taskId);
  };

  for (const task of tasks) {
    visit(task.id);
  }

  return { tasks: tasks.map((task) => ({ ...task, dependsOn: [...task.dependsOn] })) };
}

export function getRunnableTasks(graph: TaskGraph): TaskNode[] {
  const byId = new Map(graph.tasks.map((task) => [task.id, task]));

  return graph.tasks.filter((task) => {
    if (!(task.status === "queued" || task.status === "ready")) {
      return false;
    }

    return task.dependsOn.every((dependencyId) => {
      const dependency = byId.get(dependencyId);
      return dependency?.status === "completed";
    });
  });
}

export function updateTaskStatus(graph: TaskGraph, taskId: string, status: TaskStatus, blockerReason?: string): TaskGraph {
  let found = false;

  const updated = {
    tasks: graph.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }

      found = true;
      return {
        ...task,
        status,
        blockerReason: blockerReason?.trim() || (status === "blocked" ? task.blockerReason : undefined)
      };
    })
  };

  if (!found) {
    throw new Error(`Unknown task id: ${taskId}`);
  }

  return updated;
}

export function createAgentRegistry(agents: AgentDescriptor[]): AgentRegistry {
  const ids = new Set<string>();

  for (const agent of agents) {
    if (ids.has(agent.id)) {
      throw new Error(`Duplicate agent id: ${agent.id}`);
    }
    ids.add(agent.id);
  }

  return {
    agents: agents.map((agent) => ({ ...agent, supportedTaskTypes: [...agent.supportedTaskTypes] }))
  };
}

export function allocateAgent(
  registry: AgentRegistry,
  role: AgentRole,
  taskId: string
): { registry: AgentRegistry; agent: AgentDescriptor } {
  const candidate = registry.agents.find(
    (agent) => agent.role === role && agent.status === "idle"
  );

  if (!candidate) {
    throw new Error(`No idle agent available for role ${role}`);
  }

  return {
    agent: { ...candidate, status: "busy", assignedTaskId: taskId },
    registry: {
      agents: registry.agents.map((agent) =>
        agent.id === candidate.id ? { ...agent, status: "busy", assignedTaskId: taskId } : agent
      )
    }
  };
}

export function releaseAgent(registry: AgentRegistry, agentId: string): AgentRegistry {
  return {
    agents: registry.agents.map((agent) =>
      agent.id === agentId ? { ...agent, status: "idle", assignedTaskId: undefined } : agent
    )
  };
}

export class InMemoryContinuityStore implements ContinuitySnapshotStore {
  private readonly records = new Map<string, SessionSnapshot>();

  save(sessionId: string, snapshot: SessionSnapshot): void {
    this.records.set(sessionId, structuredClone(snapshot));
  }

  get(sessionId: string): SessionSnapshot | undefined {
    const snapshot = this.records.get(sessionId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }
}

export interface SessionLedgerStore extends ContinuitySnapshotStore {
  appendEvent(
    sessionId: string,
    input: {
      type: SessionEventType;
      message: string;
      taskId?: string;
      agentId?: string;
      modelId?: string;
      metadata?: JsonValue;
    }
  ): SessionEvent;
  addArtifact(
    sessionId: string,
    input: {
      kind: ArtifactKind;
      title: string;
      contentSummary: string;
      taskId?: string;
      path?: string;
      metadata?: JsonValue;
    }
  ): ArtifactRecord;
  listEvents(sessionId: string): SessionEvent[];
  listArtifacts(sessionId: string): ArtifactRecord[];
  getRecord(sessionId: string): PersistedSessionRecord | undefined;
}

export class InMemorySessionStore implements SessionLedgerStore {
  private readonly records = new Map<string, PersistedSessionRecord>();

  protected ensureRecord(sessionId: string): PersistedSessionRecord {
    const existing = this.records.get(sessionId);
    if (existing) {
      return existing;
    }

    const created = emptyRecord(sessionId);
    this.records.set(sessionId, created);
    return created;
  }

  protected restoreRecord(record: PersistedSessionRecord): void {
    this.records.set(record.sessionId, cloneRecord(record));
  }

  save(sessionId: string, snapshot: SessionSnapshot): void {
    const record = this.ensureRecord(sessionId);
    record.snapshot = structuredClone(snapshot);
  }

  get(sessionId: string): SessionSnapshot | undefined {
    const snapshot = this.records.get(sessionId)?.snapshot;
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  appendEvent(
    sessionId: string,
    input: {
      type: SessionEventType;
      message: string;
      taskId?: string;
      agentId?: string;
      modelId?: string;
      metadata?: JsonValue;
    }
  ): SessionEvent {
    const record = this.ensureRecord(sessionId);
    const event: SessionEvent = {
      id: createRecordId(),
      sessionId,
      type: input.type,
      at: new Date().toISOString(),
      message: input.message.trim(),
      taskId: input.taskId,
      agentId: input.agentId,
      modelId: input.modelId,
      metadata: input.metadata ? structuredClone(input.metadata) : undefined
    };
    record.events.push(event);
    return structuredClone(event);
  }

  addArtifact(
    sessionId: string,
    input: {
      kind: ArtifactKind;
      title: string;
      contentSummary: string;
      taskId?: string;
      path?: string;
      metadata?: JsonValue;
    }
  ): ArtifactRecord {
    const record = this.ensureRecord(sessionId);
    const artifact: ArtifactRecord = {
      id: createRecordId(),
      sessionId,
      kind: input.kind,
      title: input.title.trim(),
      createdAt: new Date().toISOString(),
      contentSummary: input.contentSummary.trim(),
      taskId: input.taskId,
      path: input.path,
      metadata: input.metadata ? structuredClone(input.metadata) : undefined
    };
    record.artifacts.push(artifact);
    return structuredClone(artifact);
  }

  listEvents(sessionId: string): SessionEvent[] {
    return structuredClone(this.records.get(sessionId)?.events ?? []);
  }

  listArtifacts(sessionId: string): ArtifactRecord[] {
    return structuredClone(this.records.get(sessionId)?.artifacts ?? []);
  }

  getRecord(sessionId: string): PersistedSessionRecord | undefined {
    const record = this.records.get(sessionId);
    return record ? cloneRecord(record) : undefined;
  }
}

export function buildRoutingCandidates(
  models: ModelDescriptor[],
  providerHealth: ProviderHealth[]
): RoutedCandidate[] {
  const healthByProvider = new Map(providerHealth.map((health) => [health.provider, health]));

  return models.map((model) => {
    const health = healthByProvider.get(model.provider);
    const available = health ? providerAvailability[health.state] : true;
    const baseScore = 70 + (health?.scoreModifier ?? 0);

    return {
      model,
      available,
      healthScore: Math.max(0, baseScore)
    };
  });
}

export function planProviderHandoff(input: {
  sessionId: string;
  continuityStore: ContinuitySnapshotStore;
  request: RoutingRequest;
  models: ModelDescriptor[];
  providerHealth: ProviderHealth[];
}): ProviderHandoffPlan {
  const snapshot = input.continuityStore.get(input.sessionId);
  if (!snapshot) {
    throw new Error(`No continuity snapshot found for session ${input.sessionId}`);
  }

  const routingCandidates = buildRoutingCandidates(input.models, input.providerHealth);
  const decision = selectNextModel(input.request, routingCandidates);
  const continuityPack = buildContinuityPack({
    ...snapshot,
    activeModelId: decision.chosen.id,
    fallbackTrail: [...snapshot.fallbackTrail, decision.chosen.id]
  });

  return {
    nextModel: decision.chosen,
    score: decision.score,
    reasons: decision.reasons,
    continuityPack,
    continuitySummary: summarizeProviderHandoff(continuityPack)
  };
}

export function getTaskCompletionStats(graph: TaskGraph): {
  total: number;
  terminal: number;
  running: number;
} {
  let terminal = 0;
  let running = 0;

  for (const task of graph.tasks) {
    if (terminalStates.has(task.status)) {
      terminal += 1;
    }
    if (task.status === "running") {
      running += 1;
    }
  }

  return {
    total: graph.tasks.length,
    terminal,
    running
  };
}

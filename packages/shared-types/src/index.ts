export type AgentRole =
  | "architect"
  | "coder"
  | "builder"
  | "reviewer"
  | "tester"
  | "browser"
  | "docs"
  | "memory";

export type ModelProvider =
  | "anthropic"
  | "deepseek"
  | "gemini"
  | "groq"
  | "openai"
  | "openrouter"
  | "ollama"
  | "custom";

export type QualityTier = "fast" | "balanced" | "strong";
export type CostTier = "low" | "medium" | "high";
export type TaskType = "chat" | "code" | "build-repair" | "review";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type TaskStatus =
  | "queued"
  | "ready"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export type AgentStatus = "idle" | "busy" | "offline";
export type ProviderHealthState = "healthy" | "degraded" | "rate_limited" | "offline";
export type ArtifactKind =
  | "continuity-pack"
  | "task-snapshot"
  | "build-log"
  | "test-report"
  | "diff"
  | "review-note"
  | "plan";
export type SessionEventType =
  | "session_seeded"
  | "agent_allocated"
  | "task_dispatched"
  | "task_transitioned"
  | "agent_released"
  | "provider_handoff_planned"
  | "artifact_recorded";
export type BuildSystem =
  | "cmake"
  | "make"
  | "ninja"
  | "msbuild"
  | "bazel"
  | "cargo"
  | "gradle"
  | "maven"
  | "npm"
  | "pnpm"
  | "yarn"
  | "uv"
  | "pip"
  | "dotnet";

export interface ModelDescriptor {
  id: string;
  label: string;
  provider: ModelProvider;
  qualityTier: QualityTier;
  costTier: CostTier;
  supportsTools: boolean;
  maxContextWindow: number;
}

export interface ChangedFile {
  path: string;
  summary: string;
}

export interface ContinuityPack {
  title: string;
  currentGoal: string;
  executiveSummary: string;
  activeModelId: string;
  fallbackTrail: string[];
  branch?: string;
  worktree?: string;
  openBlockers: string[];
  pendingActions: string[];
  changedFiles: ChangedFile[];
  latestLogs: string[];
}

export interface WorkspaceProfile {
  primaryLanguage: string | null;
  detectedLanguages: string[];
  buildSystems: BuildSystem[];
  dependencyManagers: string[];
  confidence: "low" | "medium" | "high";
  evidence: string[];
}

export interface TaskNode {
  id: string;
  title: string;
  taskType: TaskType;
  requiredRole: AgentRole;
  dependsOn: string[];
  status: TaskStatus;
  blockerReason?: string;
  assignedAgentId?: string;
}

export interface AgentDescriptor {
  id: string;
  label: string;
  role: AgentRole;
  status: AgentStatus;
  supportedTaskTypes: TaskType[];
  assignedTaskId?: string;
}

export interface ProviderHealth {
  provider: ModelProvider;
  state: ProviderHealthState;
  scoreModifier: number;
  reason?: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  at: string;
  message: string;
  taskId?: string;
  agentId?: string;
  modelId?: string;
  metadata?: JsonValue;
}

export interface ArtifactRecord {
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  createdAt: string;
  taskId?: string;
  path?: string;
  contentSummary: string;
  metadata?: JsonValue;
}

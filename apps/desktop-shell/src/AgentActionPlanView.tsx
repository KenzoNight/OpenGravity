import type { AgentActionStatus, AgentActionPlan, AgentSuggestedAction } from "./agent-action-state";
import { buildAgentEditPreview } from "./agent-edit-preview";
import {
  evaluateAgentActionPermission,
  getPermissionDecisionLabel,
  type AgentPermissionSettings,
  type PermissionAction
} from "./permission-state";

interface AgentActionPlanViewProps {
  actionPlan: AgentActionPlan;
  actionStatuses: Record<string, AgentActionStatus>;
  onApplyAction: (action: AgentSuggestedAction) => Promise<boolean>;
  onTrustAction: (action: AgentSuggestedAction) => Promise<void>;
  permissionSettings: AgentPermissionSettings;
  getActionStatusTone: (status: AgentActionStatus) => string;
  getPermissionDecisionTone: (decision: PermissionAction) => string;
  getSkillLabel?: (skillId: string) => string;
}

function describeAction(action: AgentSuggestedAction, getSkillLabel?: (skillId: string) => string): string {
  return (
    action.description ??
    action.command ??
    (action.type === "launch_skill" && action.skillId
      ? `Launch the local tool ${getSkillLabel?.(action.skillId) ?? action.skillId}`
      : undefined) ??
    (action.type === "replace_in_file"
      ? `Apply an exact text replacement in ${action.path ?? "the selected file"}`
      : action.path) ??
    (action.workflow === "recommended" ? "Run the recommended workflow" : action.type)
  );
}

export function AgentActionPlanView({
  actionPlan,
  actionStatuses,
  onApplyAction,
  onTrustAction,
  permissionSettings,
  getActionStatusTone,
  getPermissionDecisionTone,
  getSkillLabel
}: AgentActionPlanViewProps) {
  return (
    <div className="chat-action-plan">
      <div className="chat-action-plan-head">
        <strong>{actionPlan.summary}</strong>
        <span className="signal-pill">{actionPlan.actions.length} actions</span>
      </div>
      <div className="chat-action-list">
        {actionPlan.actions.map((action) => {
          const permissionDecision = evaluateAgentActionPermission(action, permissionSettings);
          const actionStatus = actionStatuses[action.id] ?? (permissionDecision === "deny" ? "blocked" : "idle");
          const editPreview =
            action.type === "replace_in_file"
              ? buildAgentEditPreview(action.findText ?? "", action.replaceText ?? "")
              : null;

          return (
            <div className="chat-action-row" key={action.id}>
              <div className="chat-action-main">
                <div className="compact-copy">
                  <strong>{action.label}</strong>
                  <span>{describeAction(action, getSkillLabel)}</span>
                </div>

                {editPreview ? (
                  <div className="agent-edit-preview">
                    <div className="agent-edit-preview-meta">
                      <span className="signal-pill">{action.path ?? "Selected file"}</span>
                      <span className="signal-pill">before {editPreview.beforeLineCount} lines</span>
                      <span className="signal-pill">after {editPreview.afterLineCount} lines</span>
                      <span className="signal-pill">
                        {editPreview.lineDelta === 0
                          ? "same size"
                          : editPreview.lineDelta > 0
                            ? `+${editPreview.lineDelta} lines`
                            : `${editPreview.lineDelta} lines`}
                      </span>
                    </div>
                    <div className="agent-edit-preview-grid">
                      <div className="agent-edit-preview-block">
                        <span className="agent-edit-preview-label">Find</span>
                        <pre>{editPreview.beforePreview || "(empty block)"}</pre>
                      </div>
                      <div className="agent-edit-preview-block is-after">
                        <span className="agent-edit-preview-label">Replace with</span>
                        <pre>{editPreview.afterPreview || "(delete this block)"}</pre>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="chat-action-row-right">
                <span className={`state-pill ${getPermissionDecisionTone(permissionDecision)}`}>
                  {getPermissionDecisionLabel(permissionDecision)}
                </span>
                <span className={`state-pill ${getActionStatusTone(actionStatus)}`}>{actionStatus}</span>
                {permissionDecision === "ask" && action.type !== "replace_in_file" ? (
                  <button
                    className="secondary-button slim-button"
                    disabled={actionStatus === "running"}
                    onClick={() => void onTrustAction(action)}
                    type="button"
                  >
                    Trust
                  </button>
                ) : null}
                <button
                  className="secondary-button slim-button"
                  disabled={actionStatus === "running" || permissionDecision === "deny"}
                  onClick={() => void onApplyAction(action)}
                  type="button"
                >
                  {permissionDecision === "deny"
                    ? "Blocked"
                    : action.type === "open_file"
                      ? "Open"
                      : action.type === "replace_in_file"
                        ? "Apply edit"
                        : action.type === "run_command"
                          ? "Run"
                          : action.type === "launch_skill"
                            ? "Launch"
                          : "Start"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Typed Hermes Agent event stream consumed by the X-Ray debugger.
 *
 * Prefer wiring these to real Hermes hooks / stream callbacks when available.
 * The scripted demo trace uses the same schema so the UI always works.
 */

export type HermesEventType =
  | "inbound"
  | "hydrate"
  | "iteration_start"
  | "reasoning"
  | "assistant_delta"
  | "tool_resolve"
  | "tool_call"
  | "tool_result"
  | "skill_resolve"
  | "skill_call"
  | "skill_result"
  | "workflow_resolve"
  | "workflow_call"
  | "workflow_result"
  | "persist"
  | "loop_decision"
  | "agent_end";

/** Pipeline stages surfaced in order, with re-entry on each agent loop. */
export type StageId =
  | "inbound"
  | "hydrate"
  | "model"
  | "tool_resolve"
  | "tool_execute"
  | "persist"
  | "loop_decision";

export type StopReason =
  | "intake"
  | "hydrating"
  | "tool_calls"
  | "text_response"
  | "max_iterations"
  | "budget_exhausted"
  | "error"
  | "user_interrupt";

export interface HermesModuleRef {
  /** Repo-relative path, e.g. agent/conversation_loop.py */
  path: string;
  /** Primary symbol, e.g. run_conversation */
  symbol: string;
  /** Short role of this module in the stage */
  role: string;
}

export interface HermesEvent {
  id: string;
  type: HermesEventType;
  /** Relative timestamp from run start (ms) */
  ts: number;
  /** Agent loop iteration (1-based); omitted for pre-loop stages */
  iteration?: number;
  stage: StageId;
  module: HermesModuleRef;
  /** One-line debugger summary */
  summary: string;
  /** Nesting depth for Step Into / Step Over (0 = stage boundary) */
  depth: number;
  /** Structured locals snapshot deltas */
  payload?: Record<string, unknown>;
}

export interface HermesTrace {
  id: string;
  title: string;
  prompt: string;
  /** Max iterations configured on AIAgent / IterationBudget */
  maxIterations: number;
  model: string;
  platform: string;
  events: HermesEvent[];
}

export function eventTypeLabel(type: HermesEventType): string {
  return type.replace(/_/g, " ");
}

import type { HermesModuleRef, StageId } from "./events";

export interface StageDef {
  id: StageId;
  num: string;
  label: string;
  detail: string;
  /** Default Hermes module owning this stage */
  module: HermesModuleRef;
}

/**
 * Stages to surface (in order, with re-entry on each loop back to model).
 * Anchors map to real Hermes Agent surfaces.
 */
export const STAGES: StageDef[] = [
  {
    id: "inbound",
    num: "01",
    label: "Inbound",
    detail: "Platform input → session identity",
    module: {
      path: "gateway/session.py",
      symbol: "SessionSource / build_session_key",
      role: "Normalize platform event into session identity",
    },
  },
  {
    id: "hydrate",
    num: "02",
    label: "Hydrate",
    detail: "History, memory, context assembly",
    module: {
      path: "agent/system_prompt.py",
      symbol: "build_system_prompt_parts",
      role: "Assemble model-visible context + history",
    },
  },
  {
    id: "model",
    num: "03",
    label: "Model",
    detail: "Reasoning / assistant turn",
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Provider call inside max_iterations / IterationBudget",
    },
  },
  {
    id: "tool_resolve",
    num: "04",
    label: "Resolve",
    detail: "Tool / skill / workflow search",
    module: {
      path: "tools/registry.py",
      symbol: "ToolRegistry.get_definitions / dispatch",
      role: "Resolve requested tools against registry schemas",
    },
  },
  {
    id: "tool_execute",
    num: "05",
    label: "Execute",
    detail: "Args in → result / error out",
    module: {
      path: "agent/tool_executor.py",
      symbol: "execute_tool_calls_sequential",
      role: "Run tool calls (sequential or concurrent)",
    },
  },
  {
    id: "persist",
    num: "06",
    label: "Persist",
    detail: "Transcript / session append",
    module: {
      path: "hermes_state.py",
      symbol: "SessionDB.append_message",
      role: "Flush messages to SQLite session DB",
    },
  },
  {
    id: "loop_decision",
    num: "07",
    label: "Loop",
    detail: "Continue vs stop → next turn or end",
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation (loop decision)",
      role: "finish_reason / tool_calls → continue or agent_end",
    },
  },
];

export const STAGE_BY_ID: Record<StageId, StageDef> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<StageId, StageDef>;

/** Extra Hermes anchors referenced in the source pane. */
export const HERMES_ANCHORS: HermesModuleRef[] = [
  {
    path: "run_agent.py",
    symbol: "AIAgent",
    role: "Agent entry, persistence hooks, tool-call forwarding",
  },
  {
    path: "agent/conversation_loop.py",
    symbol: "run_conversation",
    role: "Core agent loop (~max_iterations)",
  },
  {
    path: "agent/tool_executor.py",
    symbol: "execute_tool_calls_*",
    role: "Sequential / concurrent tool execution",
  },
  {
    path: "tools/registry.py",
    symbol: "ToolRegistry",
    role: "Self-registering schemas and dispatch",
  },
  {
    path: "agent/prompt_builder.py",
    symbol: "prompt helpers",
    role: "Prompt constants and assembly helpers",
  },
  {
    path: "gateway/session.py",
    symbol: "SessionSource / SessionStore",
    role: "Gateway session identity and routing",
  },
  {
    path: "hermes_state.py",
    symbol: "SessionDB",
    role: "SQLite transcript + FTS session store",
  },
];

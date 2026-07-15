import type { HermesEvent, HermesTrace } from "./events";

const README_EXCERPT = `# hermes-xray

Debugger-style observability for Hermes Agent.

Type a prompt and step through the runtime path:
inbound → hydrate → model → tool resolve → execute → persist → loop.

Canonical demo: read README.md, then summarize it.
`;

/**
 * Canonical canned prompt that forces two tool rounds then a final answer.
 * Uses the same event schema as a live Hermes instrumentation adapter would.
 */
export const DEMO_PROMPT =
  "What's in README.md, then summarize it.";

export const DEMO_TRACE: HermesTrace = {
  id: "demo-readme-summarize",
  title: "README read → summarize (2 tool rounds)",
  prompt: DEMO_PROMPT,
  maxIterations: 8,
  model: "scripted-demo",
  platform: "offline",
  events: buildDemoEvents(),
};

function buildDemoEvents(): HermesEvent[] {
  const events: HermesEvent[] = [];
  let t = 0;
  const add = (
    delta: number,
    partial: Omit<HermesEvent, "id" | "ts">,
  ) => {
    t += delta;
    events.push({
      id: `e${String(events.length + 1).padStart(3, "0")}`,
      ts: t,
      ...partial,
    });
  };

  // ── 1. Inbound ──────────────────────────────────────────────
  add(0, {
    type: "inbound",
    stage: "inbound",
    depth: 0,
    module: {
      path: "gateway/session.py",
      symbol: "SessionSource",
      role: "Normalize platform event into session identity",
    },
    summary: "CLI inbound prompt accepted; session key bound",
    payload: {
      platform: "cli",
      chat_type: "dm",
      session_key: "cli:local:demo-readme",
      user_message: DEMO_PROMPT,
      message_id: "msg_001",
    },
  });

  // ── 2. Hydrate ──────────────────────────────────────────────
  add(35, {
    type: "hydrate",
    stage: "hydrate",
    depth: 0,
    module: {
      path: "agent/system_prompt.py",
      symbol: "build_system_prompt_parts",
      role: "Assemble model-visible context + history",
    },
    summary: "Session hydrated: empty history, system prompt, tool schemas",
    payload: {
      history_messages: 0,
      memory_fragments: ["workspace: /Users/demo/hermes-xray"],
      skills_loaded: ["file-ops"],
      available_tools: [
        "search_files",
        "read_file",
        "write_file",
        "terminal",
        "web_search",
      ],
      prompt_stack: [
        { role: "system", chars: 2140 },
        { role: "user", chars: DEMO_PROMPT.length },
      ],
      estimated_prompt_tokens: 620,
    },
  });

  // ── Iteration 1: search_files ────────────────────────────────
  add(20, {
    type: "iteration_start",
    stage: "model",
    iteration: 1,
    depth: 0,
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Start iteration under IterationBudget",
    },
    summary: "Loop iteration #1 / 8 - api_call_count=1",
    payload: {
      iteration: 1,
      max_iterations: 8,
      budget_remaining: 7,
      api_call_count: 1,
    },
  });

  add(180, {
    type: "reasoning",
    stage: "model",
    iteration: 1,
    depth: 1,
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Provider completion for tool-seeking turn",
    },
    summary:
      "Model turn: locate README.md before reading (finish_reason=tool_calls)",
    payload: {
      finish_reason: "tool_calls",
      stop_reason: "tool_calls",
      assistant_preview:
        "I'll find README.md in the workspace, then read and summarize it.",
      tool_calls_pending: 1,
    },
  });

  add(40, {
    type: "assistant_delta",
    stage: "model",
    iteration: 1,
    depth: 2,
    module: {
      path: "run_agent.py",
      symbol: "AIAgent._emit_status",
      role: "Stream observable assistant text (not hidden CoT)",
    },
    summary: "Assistant delta: intent to search then read",
    payload: {
      delta:
        "I'll find README.md in the workspace, then read and summarize it.",
    },
  });

  add(25, {
    type: "tool_resolve",
    stage: "tool_resolve",
    iteration: 1,
    depth: 1,
    module: {
      path: "tools/registry.py",
      symbol: "ToolRegistry.get_schema",
      role: "Resolve tool name against registry",
    },
    summary: "Resolved search_files from registry (file toolset)",
    payload: {
      requested: ["search_files"],
      available: [
        "search_files",
        "read_file",
        "write_file",
        "terminal",
        "web_search",
      ],
      chosen: "search_files",
      why: "Prompt asks what is in README.md; locate path before read_file",
      toolset: "file",
      schema: {
        name: "search_files",
        parameters: { pattern: "string", path: "string?" },
      },
    },
  });

  add(30, {
    type: "tool_call",
    stage: "tool_execute",
    iteration: 1,
    depth: 2,
    module: {
      path: "agent/tool_executor.py",
      symbol: "execute_tool_calls_sequential",
      role: "Dispatch tool call with parsed args",
    },
    summary: 'tool_call search_files({ pattern: "README.md" })',
    payload: {
      tool_call_id: "call_search_1",
      name: "search_files",
      args: { pattern: "README.md", path: "." },
    },
  });

  add(55, {
    type: "tool_result",
    stage: "tool_execute",
    iteration: 1,
    depth: 2,
    module: {
      path: "tools/registry.py",
      symbol: "ToolRegistry.dispatch",
      role: "Return tool result string to message list",
    },
    summary: "search_files → 1 match: ./README.md",
    payload: {
      tool_call_id: "call_search_1",
      name: "search_files",
      duration_ms: 42,
      ok: true,
      result: {
        total_count: 1,
        matches: ["./README.md"],
      },
    },
  });

  add(20, {
    type: "persist",
    stage: "persist",
    iteration: 1,
    depth: 1,
    module: {
      path: "hermes_state.py",
      symbol: "SessionDB.append_message",
      role: "Flush assistant + tool messages",
    },
    summary: "Persisted assistant tool_calls + tool result to SessionDB",
    payload: {
      appended_roles: ["assistant", "tool"],
      session_id: "20260712_demo_readme",
      message_count: 3,
    },
  });

  add(15, {
    type: "loop_decision",
    stage: "loop_decision",
    iteration: 1,
    depth: 0,
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Continue while tool work remains",
    },
    summary: "Decision: continue - tool_calls present, budget ok",
    payload: {
      decision: "continue",
      stop_reason: "tool_calls",
      finish_reason: "tool_calls",
      next: "iteration 2",
      budget_remaining: 7,
    },
  });

  // ── Iteration 2: read_file ──────────────────────────────────
  add(25, {
    type: "iteration_start",
    stage: "model",
    iteration: 2,
    depth: 0,
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Start iteration under IterationBudget",
    },
    summary: "Loop iteration #2 / 8 - api_call_count=2",
    payload: {
      iteration: 2,
      max_iterations: 8,
      budget_remaining: 6,
      api_call_count: 2,
    },
  });

  add(160, {
    type: "reasoning",
    stage: "model",
    iteration: 2,
    depth: 1,
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Provider completion after tool result",
    },
    summary: "Model turn: read ./README.md (finish_reason=tool_calls)",
    payload: {
      finish_reason: "tool_calls",
      stop_reason: "tool_calls",
      assistant_preview: "Found README.md - reading it now.",
      tool_calls_pending: 1,
    },
  });

  add(20, {
    type: "tool_resolve",
    stage: "tool_resolve",
    iteration: 2,
    depth: 1,
    module: {
      path: "tools/registry.py",
      symbol: "ToolRegistry.get_schema",
      role: "Resolve tool name against registry",
    },
    summary: "Resolved read_file from registry (file toolset)",
    payload: {
      requested: ["read_file"],
      available: [
        "search_files",
        "read_file",
        "write_file",
        "terminal",
        "web_search",
      ],
      chosen: "read_file",
      why: "search_files returned ./README.md; read contents for summary",
      toolset: "file",
      schema: {
        name: "read_file",
        parameters: { path: "string" },
      },
    },
  });

  add(25, {
    type: "tool_call",
    stage: "tool_execute",
    iteration: 2,
    depth: 2,
    module: {
      path: "agent/tool_executor.py",
      symbol: "execute_tool_calls_sequential",
      role: "Dispatch tool call with parsed args",
    },
    summary: 'tool_call read_file({ path: "./README.md" })',
    payload: {
      tool_call_id: "call_read_1",
      name: "read_file",
      args: { path: "./README.md" },
    },
  });

  add(70, {
    type: "tool_result",
    stage: "tool_execute",
    iteration: 2,
    depth: 2,
    module: {
      path: "tools/file_tools.py",
      symbol: "read_file handler",
      role: "Return file contents to the loop",
    },
    summary: "read_file → README.md (184 bytes)",
    payload: {
      tool_call_id: "call_read_1",
      name: "read_file",
      duration_ms: 18,
      ok: true,
      result: {
        path: "./README.md",
        bytes: 184,
        content: README_EXCERPT,
      },
    },
  });

  add(20, {
    type: "persist",
    stage: "persist",
    iteration: 2,
    depth: 1,
    module: {
      path: "run_agent.py",
      symbol: "AIAgent._persist_session",
      role: "Flush after tool progress",
    },
    summary: "Persisted read_file tool result to SessionDB",
    payload: {
      appended_roles: ["assistant", "tool"],
      session_id: "20260712_demo_readme",
      message_count: 5,
    },
  });

  add(15, {
    type: "loop_decision",
    stage: "loop_decision",
    iteration: 2,
    depth: 0,
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Continue while tool work remains",
    },
    summary: "Decision: continue - need final summary turn",
    payload: {
      decision: "continue",
      stop_reason: "tool_calls",
      finish_reason: "tool_calls",
      next: "iteration 3",
      budget_remaining: 6,
    },
  });

  // ── Iteration 3: final summary ──────────────────────────────
  add(25, {
    type: "iteration_start",
    stage: "model",
    iteration: 3,
    depth: 0,
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Start iteration under IterationBudget",
    },
    summary: "Loop iteration #3 / 8 - api_call_count=3",
    payload: {
      iteration: 3,
      max_iterations: 8,
      budget_remaining: 5,
      api_call_count: 3,
    },
  });

  add(220, {
    type: "reasoning",
    stage: "model",
    iteration: 3,
    depth: 1,
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Final text response turn",
    },
    summary: "Model turn: final summary (finish_reason=stop)",
    payload: {
      finish_reason: "stop",
      stop_reason: "text_response",
      tool_calls_pending: 0,
    },
  });

  add(30, {
    type: "assistant_delta",
    stage: "model",
    iteration: 3,
    depth: 2,
    module: {
      path: "run_agent.py",
      symbol: "AIAgent._emit_status",
      role: "Stream final assistant text",
    },
    summary: "Assistant delta: README summary",
    payload: {
      delta:
        "README.md describes hermes-xray: a debugger-style observability UI for Hermes Agent. You enter a prompt and step the runtime path inbound → hydrate → model → tool resolve → execute → persist → loop. The canonical demo is reading README.md and summarizing it.",
    },
  });

  add(25, {
    type: "persist",
    stage: "persist",
    iteration: 3,
    depth: 1,
    module: {
      path: "hermes_state.py",
      symbol: "SessionDB.append_message",
      role: "Append final assistant message",
    },
    summary: "Persisted final assistant message",
    payload: {
      appended_roles: ["assistant"],
      session_id: "20260712_demo_readme",
      message_count: 6,
    },
  });

  add(15, {
    type: "loop_decision",
    stage: "loop_decision",
    iteration: 3,
    depth: 0,
    module: {
      path: "agent/conversation_loop.py",
      symbol: "run_conversation",
      role: "Stop on text_response",
    },
    summary: "Decision: stop - text_response (finish_reason=stop)",
    payload: {
      decision: "stop",
      stop_reason: "text_response",
      finish_reason: "stop",
      api_calls: "3/8",
      tool_turns: 2,
    },
  });

  add(10, {
    type: "agent_end",
    stage: "loop_decision",
    iteration: 3,
    depth: 0,
    module: {
      path: "run_agent.py",
      symbol: "AIAgent",
      role: "Close run; emit final response",
    },
    summary: "Agent ended - final response ready",
    payload: {
      stop_reason: "text_response",
      final_response:
        "README.md describes hermes-xray: a debugger-style observability UI for Hermes Agent. You enter a prompt and step the runtime path inbound → hydrate → model → tool resolve → execute → persist → loop. The canonical demo is reading README.md and summarizing it.",
      iterations_used: 3,
      tool_calls_total: 2,
    },
  });

  return events;
}

import { readFileSync, readdirSync, statSync } from "fs";
import { join, normalize, relative, resolve } from "path";
import type { HermesEvent, HermesModuleRef, HermesTrace } from "./events";
import type { InferenceProvider } from "./auth-settings";

const MAX_ITERATIONS = 6;
const WORKSPACE_ROOT = process.cwd();

const MODULES = {
  inbound: {
    path: "gateway/session.py",
    symbol: "SessionSource",
    role: "Normalize platform event into session identity",
  },
  hydrate: {
    path: "agent/system_prompt.py",
    symbol: "build_system_prompt_parts",
    role: "Assemble model-visible context + history",
  },
  loop: {
    path: "agent/conversation_loop.py",
    symbol: "run_conversation",
    role: "Provider call inside max_iterations / IterationBudget",
  },
  registry: {
    path: "tools/registry.py",
    symbol: "ToolRegistry.dispatch",
    role: "Resolve and dispatch tools",
  },
  executor: {
    path: "agent/tool_executor.py",
    symbol: "execute_tool_calls_sequential",
    role: "Run tool calls",
  },
  persist: {
    path: "hermes_state.py",
    symbol: "SessionDB.append_message",
    role: "Flush messages to session store",
  },
} as const satisfies Record<string, HermesModuleRef>;

const TOOL_DECLARATIONS = [
  {
    name: "search_files",
    description:
      "Search the workspace for filenames matching a pattern (e.g. README.md).",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Filename pattern, e.g. README.md or *.md",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "read_file",
    description:
      "Read a text file from the allowlisted workspace (README.md, package.json, hermes-xray.json, llms.txt).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path, e.g. README.md",
        },
      },
      required: ["path"],
    },
  },
] as const;

const ALLOWED_READ = new Set([
  "README.md",
  "package.json",
  "hermes-xray.json",
  "llms.txt",
  "PORTFOLIO.md",
]);

export interface RunRequest {
  prompt: string;
  provider: InferenceProvider;
  model: string;
  apiKey: string;
}

export interface RunResult {
  trace: HermesTrace;
  error?: string;
}

class EventBuilder {
  events: HermesEvent[] = [];
  private t0 = Date.now();
  private n = 0;

  push(
    partial: Omit<HermesEvent, "id" | "ts"> & { ts?: number },
  ): HermesEvent {
    this.n += 1;
    const ev: HermesEvent = {
      id: `live${String(this.n).padStart(3, "0")}`,
      ts: Date.now() - this.t0,
      ...partial,
    };
    this.events.push(ev);
    return ev;
  }
}

function safeResolve(userPath: string): string | null {
  const cleaned = userPath.replace(/^\.\//, "").replace(/^\/+/, "");
  const base = cleaned.split(/[/\\]/).pop() ?? cleaned;
  if (!ALLOWED_READ.has(base) && !ALLOWED_READ.has(cleaned)) {
    // Also allow README.md with ./ prefix variants mapped by basename
    if (!ALLOWED_READ.has(base)) return null;
  }
  const full = resolve(WORKSPACE_ROOT, base);
  const rel = relative(WORKSPACE_ROOT, full);
  if (rel.startsWith("..") || normalize(rel).includes("..")) return null;
  if (!ALLOWED_READ.has(base)) return null;
  return full;
}

function toolSearchFiles(pattern: string): unknown {
  const needle = pattern.toLowerCase().replace(/\*/g, "");
  const matches: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 2 || matches.length >= 20) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".next" || name === ".git") {
        continue;
      }
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (name.toLowerCase().includes(needle) || needle === "") {
        matches.push("./" + relative(WORKSPACE_ROOT, full));
      }
    }
  };
  walk(WORKSPACE_ROOT, 0);
  return { total_count: matches.length, matches };
}

function toolReadFile(path: string): unknown {
  const full = safeResolve(path);
  if (!full) {
    return {
      error: `Path not allowed. Allowlist: ${[...ALLOWED_READ].join(", ")}`,
    };
  }
  try {
    const content = readFileSync(full, "utf8");
    const clipped =
      content.length > 8000 ? `${content.slice(0, 8000)}\n…[truncated]` : content;
    return {
      path: relative(WORKSPACE_ROOT, full),
      bytes: Buffer.byteLength(clipped, "utf8"),
      content: clipped,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function executeTool(
  name: string,
  args: Record<string, unknown>,
): { ok: boolean; result: unknown } {
  if (name === "search_files") {
    const pattern = String(args.pattern ?? "README");
    return { ok: true, result: toolSearchFiles(pattern) };
  }
  if (name === "read_file") {
    const path = String(args.path ?? "");
    const result = toolReadFile(path);
    const ok = !(result && typeof result === "object" && "error" in result);
    return { ok, result };
  }
  return { ok: false, result: { error: `Unknown tool: ${name}` } };
}

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: ToolCall[];
      /** Raw Gemini model parts — must be echoed for thought signatures. */
      geminiParts?: Array<Record<string, unknown>>;
    }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  finishReason: string;
  geminiParts?: Array<Record<string, unknown>>;
}

const SYSTEM_PROMPT = `You are Hermes Agent inside hermes-xray, a debugger demo.
You have tools: search_files and read_file (allowlisted workspace files only).
When the user asks about README.md or project files, use tools — do not invent file contents.
After you have enough evidence, give a concise final answer.
Keep tool use minimal (typically search then read, then answer).`;

export async function runLiveAgent(req: RunRequest): Promise<RunResult> {
  const prompt = req.prompt.trim();
  if (!prompt) {
    return {
      trace: emptyTrace(req, "(empty)"),
      error: "Prompt is required",
    };
  }
  if (!req.apiKey?.trim()) {
    return {
      trace: emptyTrace(req, prompt),
      error: "API key is missing",
    };
  }

  const b = new EventBuilder();
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  b.push({
    type: "inbound",
    stage: "inbound",
    depth: 0,
    module: MODULES.inbound,
    summary: "Live inbound prompt accepted",
    payload: {
      platform: "web",
      provider: req.provider,
      model: req.model,
      user_message: prompt,
    },
  });

  b.push({
    type: "hydrate",
    stage: "hydrate",
    depth: 0,
    module: MODULES.hydrate,
    summary: "Session hydrated for live run",
    payload: {
      history_messages: 0,
      available_tools: TOOL_DECLARATIONS.map((t) => t.name),
      estimated_prompt_tokens: Math.ceil((SYSTEM_PROMPT.length + prompt.length) / 4),
      provider: req.provider,
      model: req.model,
    },
  });

  let messageCount = 1;
  let toolCallsTotal = 0;

  try {
    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      b.push({
        type: "iteration_start",
        stage: "model",
        iteration,
        depth: 0,
        module: MODULES.loop,
        summary: `Loop iteration #${iteration} / ${MAX_ITERATIONS}`,
        payload: {
          iteration,
          max_iterations: MAX_ITERATIONS,
          budget_remaining: MAX_ITERATIONS - iteration,
          api_call_count: iteration,
        },
      });

      const turn = await callModel(req, messages);

      b.push({
        type: "reasoning",
        stage: "model",
        iteration,
        depth: 1,
        module: MODULES.loop,
        summary: turn.toolCalls.length
          ? `Model turn: tool_calls (${turn.toolCalls.map((t) => t.name).join(", ")})`
          : `Model turn: text_response (${turn.finishReason})`,
        payload: {
          finish_reason: turn.finishReason,
          stop_reason: turn.toolCalls.length ? "tool_calls" : "text_response",
          assistant_preview: turn.text.slice(0, 240),
          tool_calls_pending: turn.toolCalls.length,
        },
      });

      if (turn.text) {
        b.push({
          type: "assistant_delta",
          stage: "model",
          iteration,
          depth: 2,
          module: MODULES.loop,
          summary: "Assistant delta",
          payload: { delta: turn.text },
        });
      }

      if (turn.toolCalls.length === 0) {
        messageCount += 1;
        b.push({
          type: "persist",
          stage: "persist",
          iteration,
          depth: 1,
          module: MODULES.persist,
          summary: "Persisted final assistant message",
          payload: {
            appended_roles: ["assistant"],
            message_count: messageCount,
          },
        });
        b.push({
          type: "loop_decision",
          stage: "loop_decision",
          iteration,
          depth: 0,
          module: MODULES.loop,
          summary: "Decision: stop — text_response",
          payload: {
            decision: "stop",
            stop_reason: "text_response",
            finish_reason: turn.finishReason,
            api_calls: `${iteration}/${MAX_ITERATIONS}`,
            tool_turns: toolCallsTotal,
          },
        });
        b.push({
          type: "agent_end",
          stage: "loop_decision",
          iteration,
          depth: 0,
          module: MODULES.loop,
          summary: "Agent ended — final response ready",
          payload: {
            stop_reason: "text_response",
            final_response: turn.text,
            iterations_used: iteration,
            tool_calls_total: toolCallsTotal,
          },
        });

        return {
          trace: {
            id: `live-${Date.now()}`,
            title: "Live Hermes-style run",
            prompt,
            maxIterations: MAX_ITERATIONS,
            model: req.model,
            platform: `web:${req.provider}`,
            events: b.events,
          },
        };
      }

      messages.push({
        role: "assistant",
        content: turn.text,
        tool_calls: turn.toolCalls,
        geminiParts: turn.geminiParts,
      });

      for (const tc of turn.toolCalls) {
        toolCallsTotal += 1;
        b.push({
          type: "tool_resolve",
          stage: "tool_resolve",
          iteration,
          depth: 1,
          module: MODULES.registry,
          summary: `Resolved ${tc.name} from registry`,
          payload: {
            requested: [tc.name],
            available: TOOL_DECLARATIONS.map((t) => t.name),
            chosen: tc.name,
            why: "Model requested tool via function call",
          },
        });
        b.push({
          type: "tool_call",
          stage: "tool_execute",
          iteration,
          depth: 2,
          module: MODULES.executor,
          summary: `tool_call ${tc.name}(${JSON.stringify(tc.args)})`,
          payload: {
            tool_call_id: tc.id,
            name: tc.name,
            args: tc.args,
          },
        });

        const started = Date.now();
        const { ok, result } = executeTool(tc.name, tc.args);
        b.push({
          type: "tool_result",
          stage: "tool_execute",
          iteration,
          depth: 2,
          module: MODULES.registry,
          summary: ok
            ? `${tc.name} → ok`
            : `${tc.name} → error`,
          payload: {
            tool_call_id: tc.id,
            name: tc.name,
            duration_ms: Date.now() - started,
            ok,
            result,
          },
        });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify(result),
        });
        messageCount += 2;
      }

      b.push({
        type: "persist",
        stage: "persist",
        iteration,
        depth: 1,
        module: MODULES.persist,
        summary: "Persisted assistant tool_calls + tool results",
        payload: {
          appended_roles: ["assistant", "tool"],
          message_count: messageCount,
        },
      });
      b.push({
        type: "loop_decision",
        stage: "loop_decision",
        iteration,
        depth: 0,
        module: MODULES.loop,
        summary: "Decision: continue — tool_calls present",
        payload: {
          decision: "continue",
          stop_reason: "tool_calls",
          next: `iteration ${iteration + 1}`,
          budget_remaining: MAX_ITERATIONS - iteration,
        },
      });
    }

    b.push({
      type: "agent_end",
      stage: "loop_decision",
      depth: 0,
      module: MODULES.loop,
      summary: "Agent ended — max_iterations",
      payload: {
        stop_reason: "max_iterations",
        final_response: "Stopped: max iterations reached.",
        tool_calls_total: toolCallsTotal,
      },
    });

    return {
      trace: {
        id: `live-${Date.now()}`,
        title: "Live Hermes-style run",
        prompt,
        maxIterations: MAX_ITERATIONS,
        model: req.model,
        platform: `web:${req.provider}`,
        events: b.events,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    b.push({
      type: "agent_end",
      stage: "loop_decision",
      depth: 0,
      module: MODULES.loop,
      summary: `Agent ended — error: ${message}`,
      payload: {
        stop_reason: "error",
        final_response: message,
      },
    });
    return {
      trace: {
        id: `live-error-${Date.now()}`,
        title: "Live run error",
        prompt,
        maxIterations: MAX_ITERATIONS,
        model: req.model,
        platform: `web:${req.provider}`,
        events: b.events,
      },
      error: message,
    };
  }
}

function emptyTrace(req: RunRequest, prompt: string): HermesTrace {
  return {
    id: "live-empty",
    title: "Live run",
    prompt,
    maxIterations: MAX_ITERATIONS,
    model: req.model,
    platform: `web:${req.provider}`,
    events: [],
  };
}

async function callModel(
  req: RunRequest,
  messages: ChatMessage[],
): Promise<ModelTurn> {
  if (req.provider === "google") {
    return callGemini(req, messages);
  }
  if (req.provider === "anthropic") {
    return callAnthropic(req, messages);
  }
  return callOpenAICompatible(req, messages);
}

async function callGemini(
  req: RunRequest,
  messages: ChatMessage[],
): Promise<ModelTurn> {
  const system =
    messages.find((m) => m.role === "system")?.content ?? SYSTEM_PROMPT;
  const contents: Array<{
    role: "user" | "model";
    parts: Array<Record<string, unknown>>;
  }> = [];

  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi];
    if (m.role === "system") continue;
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      if (m.geminiParts?.length) {
        // Replay exact model parts so thoughtSignature survives tool loops.
        contents.push({ role: "model", parts: m.geminiParts });
      } else {
        const parts: Array<Record<string, unknown>> = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.tool_calls ?? []) {
          const part: Record<string, unknown> = {
            functionCall: { name: tc.name, args: tc.args },
          };
          if (tc.thoughtSignature) {
            part.thoughtSignature = tc.thoughtSignature;
          }
          parts.push(part);
        }
        contents.push({
          role: "model",
          parts: parts.length ? parts : [{ text: "" }],
        });
      }
    } else if (m.role === "tool") {
      // Gemini expects one user turn with all functionResponse parts for the
      // current tool round (since the last model functionCall turn).
      const parts: Array<Record<string, unknown>> = [
        {
          functionResponse: {
            name: m.name,
            response: safeJson(m.content),
          },
        },
      ];
      while (mi + 1 < messages.length && messages[mi + 1].role === "tool") {
        mi += 1;
        const next = messages[mi];
        if (next.role !== "tool") break;
        parts.push({
          functionResponse: {
            name: next.name,
            response: safeJson(next.content),
          },
        });
      }
      contents.push({ role: "user", parts });
    }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [
        {
          functionDeclarations: TOOL_DECLARATIONS.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
      },
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      (data.error as { message?: string } | undefined)?.message ??
      JSON.stringify(data).slice(0, 400);
    throw new Error(`Gemini error (${res.status}): ${err}`);
  }

  const candidate = (data.candidates as Array<Record<string, unknown>> | undefined)?.[0];
  const parts =
    ((candidate?.content as { parts?: Array<Record<string, unknown>> })?.parts) ??
    [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  let i = 0;
  for (const part of parts) {
    // Thought/summary parts are for reasoning continuity — do not treat as answer text.
    if (part.thought === true) continue;
    if (typeof part.text === "string") text += part.text;
    const fc = part.functionCall as
      | { name?: string; args?: Record<string, unknown> }
      | undefined;
    if (fc?.name) {
      i += 1;
      const signature =
        typeof part.thoughtSignature === "string"
          ? part.thoughtSignature
          : typeof part.thought_signature === "string"
            ? part.thought_signature
            : undefined;
      toolCalls.push({
        id: `call_${i}_${fc.name}`,
        name: fc.name,
        args: fc.args ?? {},
        thoughtSignature: signature,
      });
    }
  }

  const finishReason = String(candidate?.finishReason ?? "STOP").toLowerCase();
  return {
    text,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : finishReason,
    // Keep the exact parts array for the next request (signatures included).
    geminiParts: parts.length ? parts : undefined,
  };
}

async function callOpenAICompatible(
  req: RunRequest,
  messages: ChatMessage[],
): Promise<ModelTurn> {
  const base = openAICompatibleBase(req.provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${req.apiKey}`,
  };
  if (req.provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_SITE_URL?.trim() || "https://hermes-xray.local";
    headers["X-Title"] = "hermes-xray";
  }

  const openaiMessages: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user") {
      openaiMessages.push({ role: m.role, content: m.content });
    } else if (m.role === "assistant") {
      openaiMessages.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: (m.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      });
    } else if (m.role === "tool") {
      openaiMessages.push({
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: m.content,
      });
    }
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: req.model,
      messages: openaiMessages,
      tools: TOOL_DECLARATIONS.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      temperature: 0.2,
      max_tokens: 1024,
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      (data.error as { message?: string } | undefined)?.message ??
      JSON.stringify(data).slice(0, 400);
    throw new Error(`${req.provider} error (${res.status}): ${err}`);
  }

  const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = (choice?.message ?? {}) as {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      function?: { name?: string; arguments?: string };
    }>;
  };

  const toolCalls: ToolCall[] = [];
  for (const tc of message.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function?.arguments ?? "{}") as Record<
        string,
        unknown
      >;
    } catch {
      args = {};
    }
    toolCalls.push({
      id: tc.id,
      name: tc.function?.name ?? "unknown",
      args,
    });
  }

  const finish = String(choice?.finish_reason ?? "stop");
  return {
    text: message.content ?? "",
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : finish,
  };
}

async function callAnthropic(
  req: RunRequest,
  messages: ChatMessage[],
): Promise<ModelTurn> {
  const system =
    messages.find((m) => m.role === "system")?.content ?? SYSTEM_PROMPT;
  const anthropicMessages: Array<Record<string, unknown>> = [];

  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi];
    if (m.role === "system") continue;
    if (m.role === "user") {
      anthropicMessages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls ?? []) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.args,
        });
      }
      anthropicMessages.push({
        role: "assistant",
        content: content.length ? content : [{ type: "text", text: "" }],
      });
    } else if (m.role === "tool") {
      const content: Array<Record<string, unknown>> = [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: m.content,
        },
      ];
      while (mi + 1 < messages.length && messages[mi + 1].role === "tool") {
        mi += 1;
        const next = messages[mi];
        if (next.role !== "tool") break;
        content.push({
          type: "tool_result",
          tool_use_id: next.tool_call_id,
          content: next.content,
        });
      }
      anthropicMessages.push({ role: "user", content });
    }
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": req.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: 1024,
      system,
      tools: TOOL_DECLARATIONS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      messages: anthropicMessages,
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      (data.error as { message?: string } | undefined)?.message ??
      JSON.stringify(data).slice(0, 400);
    throw new Error(`anthropic error (${res.status}): ${err}`);
  }

  const blocks =
    (data.content as Array<Record<string, unknown>> | undefined) ?? [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: String(block.id ?? `tool_${toolCalls.length + 1}`),
        name: String(block.name ?? "unknown"),
        args:
          block.input && typeof block.input === "object"
            ? (block.input as Record<string, unknown>)
            : {},
      });
    }
  }

  const stop = String(data.stop_reason ?? "end_turn");
  return {
    text,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : stop,
  };
}

function openAICompatibleBase(provider: InferenceProvider): string {
  switch (provider) {
    case "xai":
      return "https://api.x.ai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "huggingface":
      return "https://router.huggingface.co/v1";
    case "openai":
    default:
      return "https://api.openai.com/v1";
  }
}

function safeJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return { result: content };
  }
}

/** Default cheap portfolio model — override with GEMINI_MODEL. */
export function defaultPortfolioModel(): string {
  // Match current AI Studio / Hermes free-tier Flash-Lite; older 2.0 ids often return limit: 0.
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite-preview";
}

export function defaultModelForProvider(provider: InferenceProvider): string {
  if (provider === "google") {
    return defaultPortfolioModel();
  }
  if (provider === "openai") {
    return process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
  }
  if (provider === "anthropic") {
    return process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5";
  }
  if (provider === "xai") {
    return process.env.XAI_MODEL?.trim() || "grok-2-latest";
  }
  if (provider === "openrouter") {
    return process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini";
  }
  if (provider === "huggingface") {
    return (
      process.env.HUGGINGFACE_MODEL?.trim() || "Qwen/Qwen2.5-7B-Instruct"
    );
  }
  return "gpt-4.1-mini";
}

export function portfolioApiKey(): string | null {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    null
  );
}

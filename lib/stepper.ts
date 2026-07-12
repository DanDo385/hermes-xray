import type { HermesEvent, HermesTrace, StageId, StopReason } from "./events";
import { STAGE_BY_ID } from "./stages";

export type DebuggerMode = "paused" | "running" | "stopped";

export interface StackFrame {
  label: string;
  stage: StageId;
  iteration?: number;
  module: string;
  symbol: string;
  active: boolean;
}

export interface WatchState {
  prompt: string;
  iteration: number | null;
  maxIterations: number;
  budgetRemaining: number | null;
  stopReason: StopReason | string;
  finishReason: string | null;
  selectedTools: string[];
  lastToolArgs: Record<string, unknown> | null;
  lastToolResult: unknown;
  availableTools: string[];
  messageCount: number;
  estimatedPromptTokens: number | null;
  finalResponse: string | null;
  messages: Array<{ role: string; preview: string }>;
}

export interface DebuggerSnapshot {
  index: number;
  event: HermesEvent | null;
  visibleEvents: HermesEvent[];
  stack: StackFrame[];
  watches: WatchState;
  activeStage: StageId | null;
  done: boolean;
}

export function isStageBoundary(event: HermesEvent): boolean {
  return event.depth === 0;
}

/** Step Into: advance exactly one event. */
export function stepInto(index: number, events: HermesEvent[]): number {
  if (events.length === 0) return -1;
  if (index < 0) return 0;
  return Math.min(index + 1, events.length - 1);
}

/**
 * Step Over: advance to the next event at depth <= current depth,
 * skipping nested detail under the current frame.
 */
export function stepOver(index: number, events: HermesEvent[]): number {
  if (events.length === 0) return -1;
  if (index < 0) return 0;
  const current = events[index];
  const targetDepth = current.depth;
  for (let i = index + 1; i < events.length; i++) {
    if (events[i].depth <= targetDepth) return i;
  }
  return events.length - 1;
}

/** Continue target: last event (playback animates toward this). */
export function continueTarget(events: HermesEvent[]): number {
  return Math.max(events.length - 1, -1);
}

export function deriveSnapshot(
  trace: HermesTrace,
  index: number,
): DebuggerSnapshot {
  const { events } = trace;
  if (events.length === 0 || index < 0) {
    return {
      index: -1,
      event: null,
      visibleEvents: [],
      stack: [],
      watches: emptyWatches(trace),
      activeStage: null,
      done: false,
    };
  }

  const clamped = Math.min(index, events.length - 1);
  const visibleEvents = events.slice(0, clamped + 1);
  const event = events[clamped];
  const watches = deriveWatches(trace, visibleEvents);
  const stack = deriveStack(visibleEvents);

  return {
    index: clamped,
    event,
    visibleEvents,
    stack,
    watches,
    activeStage: event.stage,
    done: clamped === events.length - 1 && event.type === "agent_end",
  };
}

function emptyWatches(trace: HermesTrace): WatchState {
  return {
    prompt: trace.prompt,
    iteration: null,
    maxIterations: trace.maxIterations,
    budgetRemaining: null,
    stopReason: "intake",
    finishReason: null,
    selectedTools: [],
    lastToolArgs: null,
    lastToolResult: null,
    availableTools: [],
    messageCount: 0,
    estimatedPromptTokens: null,
    finalResponse: null,
    messages: [],
  };
}

function deriveWatches(
  trace: HermesTrace,
  visible: HermesEvent[],
): WatchState {
  const watches = emptyWatches(trace);
  const messages: WatchState["messages"] = [];

  for (const ev of visible) {
    const p = ev.payload ?? {};

    if (typeof p.iteration === "number") watches.iteration = p.iteration;
    else if (ev.iteration != null) watches.iteration = ev.iteration;

    if (typeof p.budget_remaining === "number") {
      watches.budgetRemaining = p.budget_remaining;
    }
    if (typeof p.max_iterations === "number") {
      watches.maxIterations = p.max_iterations;
    }
    if (typeof p.stop_reason === "string") watches.stopReason = p.stop_reason;
    if (typeof p.finish_reason === "string") {
      watches.finishReason = p.finish_reason;
    }
    if (Array.isArray(p.available_tools)) {
      watches.availableTools = p.available_tools as string[];
    }
    if (typeof p.estimated_prompt_tokens === "number") {
      watches.estimatedPromptTokens = p.estimated_prompt_tokens;
    }
    if (typeof p.message_count === "number") {
      watches.messageCount = p.message_count;
    }
    if (typeof p.final_response === "string") {
      watches.finalResponse = p.final_response;
    }

    if (ev.type === "inbound" && typeof p.user_message === "string") {
      messages.push({ role: "user", preview: p.user_message });
    }
    if (ev.type === "assistant_delta" && typeof p.delta === "string") {
      messages.push({ role: "assistant", preview: p.delta });
    }
    if (ev.type === "tool_resolve" && typeof p.chosen === "string") {
      if (!watches.selectedTools.includes(p.chosen)) {
        watches.selectedTools = [...watches.selectedTools, p.chosen];
      }
    }
    if (ev.type === "tool_call") {
      watches.lastToolArgs = {
        name: p.name,
        ...(typeof p.args === "object" && p.args ? (p.args as object) : {}),
      };
      messages.push({
        role: "tool_call",
        preview: `${String(p.name)}(${JSON.stringify(p.args ?? {})})`,
      });
    }
    if (ev.type === "tool_result") {
      watches.lastToolResult = p.result ?? p;
      messages.push({
        role: "tool_result",
        preview: summarizeValue(p.result ?? p),
      });
    }
  }

  watches.messages = messages;
  return watches;
}

function deriveStack(visible: HermesEvent[]): StackFrame[] {
  const frames: StackFrame[] = [];

  const pushUnique = (frame: StackFrame, match: (f: StackFrame) => boolean) => {
    const idx = frames.findIndex(match);
    if (idx >= 0) {
      frames[idx] = frame;
      // Drop anything after this frame (deeper frames from prior path)
      frames.length = idx + 1;
    } else {
      frames.push(frame);
    }
  };

  for (const ev of visible) {
    if (ev.type === "inbound") {
      pushUnique(
        frameFrom(ev, "inbound / platform input"),
        (f) => f.stage === "inbound",
      );
    }
    if (ev.type === "hydrate") {
      pushUnique(
        frameFrom(ev, "session hydration"),
        (f) => f.stage === "hydrate",
      );
    }
    if (ev.type === "iteration_start") {
      // New iteration: keep inbound + hydrate, replace loop frame and below
      const base = frames.filter(
        (f) => f.stage === "inbound" || f.stage === "hydrate",
      );
      frames.length = 0;
      frames.push(...base);
      frames.push(frameFrom(ev, `loop #${ev.iteration} · run_conversation`));
    }
    if (ev.type === "reasoning") {
      pushUnique(
        frameFrom(ev, "model / reasoning turn"),
        (f) => f.stage === "model" && f.label.startsWith("model"),
      );
    }
    if (ev.type === "tool_resolve" || ev.type === "skill_resolve") {
      pushUnique(
        frameFrom(ev, "tool resolve"),
        (f) => f.stage === "tool_resolve",
      );
    }
    if (ev.type === "tool_call" || ev.type === "tool_result") {
      pushUnique(
        frameFrom(ev, "tool execute"),
        (f) => f.stage === "tool_execute",
      );
    }
    if (ev.type === "persist") {
      pushUnique(
        frameFrom(ev, "persist / SessionDB"),
        (f) => f.stage === "persist",
      );
    }
    if (ev.type === "loop_decision") {
      pushUnique(
        frameFrom(
          ev,
          `loop decision${ev.iteration ? ` (#${ev.iteration})` : ""}`,
        ),
        (f) => f.stage === "loop_decision",
      );
    }
    if (ev.type === "agent_end") {
      pushUnique(frameFrom(ev, "agent_end"), (f) => f.label === "agent_end");
    }
  }

  if (frames.length > 0) {
    frames.forEach((f, i) => {
      f.active = i === frames.length - 1;
    });
  }
  return frames;
}

function frameFrom(ev: HermesEvent, label: string): StackFrame {
  return {
    label,
    stage: ev.stage,
    iteration: ev.iteration,
    module: ev.module.path,
    symbol: ev.module.symbol,
    active: false,
  };
}

function summarizeValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  try {
    const s = JSON.stringify(value);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return String(value);
  }
}

export function formatTs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const rem = ms % 1000;
  return `+${sec}.${String(rem).padStart(3, "0")}s`;
}

export function stageLabel(stage: StageId): string {
  return STAGE_BY_ID[stage]?.label ?? stage;
}

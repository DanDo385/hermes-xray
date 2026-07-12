import type { HermesEvent, HermesTrace } from "./events";

export interface StoryBeat {
  id: string;
  eventId: string;
  kind:
    | "arrive"
    | "prep"
    | "loop"
    | "think"
    | "tool"
    | "result"
    | "save"
    | "loop_back"
    | "finale";
  title: string;
  body: string;
  iteration?: number;
  /** True when this beat closes a loop turn */
  turnEnd?: boolean;
  /** Final answer text when present */
  finale?: boolean;
}

function preview(value: unknown, max = 160): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Turn Hermes events into plain-English story beats for Fun Mode. */
export function narrateTrace(trace: HermesTrace): StoryBeat[] {
  const beats: StoryBeat[] = [];

  for (const ev of trace.events) {
    const beat = narrateEvent(ev);
    if (beat) beats.push(beat);
  }

  return beats;
}

function narrateEvent(ev: HermesEvent): StoryBeat | null {
  const p = ev.payload ?? {};
  const iter = ev.iteration;

  switch (ev.type) {
    case "inbound":
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "arrive",
        title: "Your prompt just landed",
        body: `Hermes received: “${preview(p.user_message ?? "", 200)}”. It’s opening a session and getting ready to look around.`,
      };
    case "hydrate":
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "prep",
        title: "Gathering context",
        body: `It’s loading history, memory, and available tools${
          Array.isArray(p.available_tools)
            ? ` (${(p.available_tools as string[]).slice(0, 4).join(", ")}${(p.available_tools as string[]).length > 4 ? "…" : ""})`
            : ""
        }. Think of this as clearing a desk before work starts.`,
      };
    case "iteration_start":
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "loop",
        iteration: iter,
        title: `Loop turn #${iter ?? "?"} begins`,
        body: `Time loops once more — this is agent round ${iter}. Hermes will think, maybe call tools, then decide whether to continue.`,
      };
    case "reasoning":
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "think",
        iteration: iter,
        title: "Starting to reason",
        body: p.assistant_preview
          ? `It’s thinking out loud (observable intent only): “${preview(p.assistant_preview, 220)}”`
          : `It’s weighing the next move${p.stop_reason === "tool_calls" ? " and looks like it wants a tool" : " toward a written answer"}.`,
      };
    case "assistant_delta":
      // Skip tiny deltas if reasoning already covered; still narrate finals later
      if (typeof p.delta === "string" && p.delta.length > 40) {
        return {
          id: `beat-${ev.id}`,
          eventId: ev.id,
          kind: "think",
          iteration: iter,
          title: "Writing a bit of the answer",
          body: `Draft words are forming: “${preview(p.delta, 200)}”`,
        };
      }
      return null;
    case "tool_resolve":
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "tool",
        iteration: iter,
        title: `Picking a tool: ${String(p.chosen ?? "unknown")}`,
        body: p.why
          ? `Why this one? ${preview(p.why, 200)}`
          : `It resolved “${String(p.chosen)}” from the tool shelf and is getting ready to call it.`,
      };
    case "tool_call":
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "tool",
        iteration: iter,
        title: `Calling ${String(p.name ?? "tool")}`,
        body: `Args headed out the door: ${preview(p.args ?? {}, 180)}. Waiting on the result…`,
      };
    case "tool_result":
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "result",
        iteration: iter,
        title: p.ok === false ? "Tool stumbled" : "Tool came back",
        body: `Here’s what ${String(p.name ?? "the tool")} returned: ${preview(p.result ?? p, 220)}`,
      };
    case "persist":
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "save",
        iteration: iter,
        turnEnd: true,
        title: "Saving this beat",
        body: `Transcript update — messages on disk now ≈ ${String(p.message_count ?? "…")}. The loop can safely continue or stop.`,
      };
    case "loop_decision":
      if (p.decision === "continue") {
        return {
          id: `beat-${ev.id}`,
          eventId: ev.id,
          kind: "loop_back",
          iteration: iter,
          turnEnd: true,
          title: "Not done — looping again",
          body: "There’s still tool work (or unfinished thinking), so Hermes winds the clock and starts another turn.",
        };
      }
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "finale",
        iteration: iter,
        turnEnd: true,
        title: "Ready to finish",
        body: `Stop reason: ${String(p.stop_reason ?? "text_response")}. The last response is coming next.`,
      };
    case "agent_end":
      return {
        id: `beat-${ev.id}`,
        eventId: ev.id,
        kind: "finale",
        iteration: iter,
        finale: true,
        turnEnd: true,
        title: "Final response",
        body:
          typeof p.final_response === "string"
            ? p.final_response
            : ev.summary,
      };
    default:
      return null;
  }
}

export function groupBeatsByLoop(beats: StoryBeat[]): {
  prep: StoryBeat[];
  loops: Array<{ iteration: number; beats: StoryBeat[] }>;
  finale: StoryBeat[];
} {
  const prep: StoryBeat[] = [];
  const loops = new Map<number, StoryBeat[]>();
  const finale: StoryBeat[] = [];

  for (const b of beats) {
    if (b.finale || (b.kind === "finale" && !b.iteration)) {
      finale.push(b);
      continue;
    }
    if (b.iteration == null) {
      prep.push(b);
      continue;
    }
    const list = loops.get(b.iteration) ?? [];
    list.push(b);
    loops.set(b.iteration, list);
  }

  // finale beats that still have iteration (loop_decision stop + agent_end)
  const finaleFromLoops: StoryBeat[] = [];
  for (const [iter, list] of loops) {
    const kept: StoryBeat[] = [];
    for (const b of list) {
      if (b.finale || (b.kind === "finale" && b.title === "Final response")) {
        finaleFromLoops.push(b);
      } else if (b.kind === "finale" && b.title === "Ready to finish") {
        finaleFromLoops.push(b);
      } else {
        kept.push(b);
      }
    }
    loops.set(iter, kept);
  }

  return {
    prep,
    loops: [...loops.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([iteration, beats]) => ({ iteration, beats })),
    finale: [...finaleFromLoops, ...finale],
  };
}

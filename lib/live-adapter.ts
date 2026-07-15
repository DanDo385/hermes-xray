import type { HermesEvent, HermesTrace } from "./events";
import { DEMO_TRACE } from "./demo-trace";

/**
 * Future live instrumentation adapter.
 *
 * When Hermes exposes stream callbacks / hooks (conversation_loop step
 * callbacks, tool start/progress callbacks, SessionDB flush), map them
 * into HermesEvent and feed the same debugger UI.
 *
 * Until then, consumers should use getScriptedTrace().
 */
export interface HermesLiveAdapter {
  /** Start a run for the given prompt; returns a trace id */
  start(prompt: string): Promise<string>;
  /** Subscribe to typed events as they fire */
  subscribe(traceId: string, onEvent: (event: HermesEvent) => void): () => void;
  /** Abort an in-flight run */
  stop(traceId: string): Promise<void>;
}

/** Always-available fallback: high-fidelity scripted demo trace. */
export function getScriptedTrace(prompt?: string): HermesTrace {
  if (!prompt || prompt.trim() === DEMO_TRACE.prompt) {
    return DEMO_TRACE;
  }
  // Custom prompts still replay the canonical topology with the prompt swapped
  // into the inbound event - keeps stepping deterministic.
  const events = DEMO_TRACE.events.map((ev) => {
    if (ev.type !== "inbound") return ev;
    return {
      ...ev,
      payload: {
        ...ev.payload,
        user_message: prompt,
      },
      summary: "CLI inbound prompt accepted; session key bound",
    };
  });
  return {
    ...DEMO_TRACE,
    id: "demo-custom-prompt",
    prompt,
    events,
  };
}

export function createNoopLiveAdapter(): HermesLiveAdapter {
  return {
    async start() {
      throw new Error(
        "Live Hermes instrumentation is not wired yet. Use getScriptedTrace().",
      );
    },
    subscribe() {
      return () => undefined;
    },
    async stop() {
      /* noop */
    },
  };
}

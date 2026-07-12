"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthPanel, useAuthSettings } from "@/components/AuthPanel";
import { SiteNav } from "@/components/SiteNav";
import { DEMO_PROMPT } from "@/lib/demo-trace";
import { eventTypeLabel, type HermesTrace } from "@/lib/events";
import { getScriptedTrace } from "@/lib/live-adapter";
import { STAGES } from "@/lib/stages";
import {
  continueTarget,
  deriveSnapshot,
  formatTs,
  stepInto,
  stepOver,
  type DebuggerMode,
} from "@/lib/stepper";

const CONTINUE_MS = 280;

export function Debugger() {
  const [prompt, setPrompt] = useState(DEMO_PROMPT);
  const [trace, setTrace] = useState(() => getScriptedTrace(DEMO_PROMPT));
  const [index, setIndex] = useState(-1);
  const [mode, setMode] = useState<DebuggerMode>("stopped");
  const [auth, setAuth] = useAuthSettings();
  const [liveBusy, setLiveBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [portfolioModel, setPortfolioModel] = useState("gemini-2.0-flash-lite");
  const [portfolioReady, setPortfolioReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onAuthStatus = useCallback(
    (
      status: {
        portfolioGemini: boolean;
        portfolioModel: string;
      } | null,
    ) => {
      if (!status) return;
      setPortfolioReady(status.portfolioGemini);
      setPortfolioModel(status.portfolioModel);
    },
    [],
  );

  const displayModel = (() => {
    const live = trace.platform.startsWith("web:");
    if (live) return trace.model;
    if (auth.mode === "portfolio") return portfolioModel;
    if (auth.mode === "byok") {
      if (auth.byokProvider === "google") {
        return `${portfolioModel} (visitor key)`;
      }
      if (auth.byokProvider === "openai") return "openai (visitor key)";
      return "xai (visitor key)";
    }
    return trace.model === "gpt-5.5" ? "scripted-demo" : trace.model;
  })();

  const displayPlatform = (() => {
    if (trace.platform.startsWith("web:")) return trace.platform;
    if (auth.mode === "portfolio") return "site-gemini";
    if (auth.mode === "byok") return `byok:${auth.byokProvider}`;
    return trace.platform === "cli" ? "offline" : trace.platform;
  })();

  const snapshot = useMemo(
    () => deriveSnapshot(trace, index),
    [trace, index],
  );

  const visitedStages = useMemo(() => {
    const set = new Set(snapshot.visibleEvents.map((e) => e.stage));
    return set;
  }, [snapshot.visibleEvents]);

  const stopContinue = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopContinue();
    setIndex(-1);
    setMode("stopped");
    setRunError(null);
  }, [stopContinue]);

  const applyTrace = useCallback(
    (next: HermesTrace) => {
      stopContinue();
      setTrace(next);
      setPrompt(next.prompt);
      setIndex(0);
      setMode("paused");
    },
    [stopContinue],
  );

  const beginTrace = useCallback(
    (nextPrompt: string) => {
      setRunError(null);
      applyTrace(getScriptedTrace(nextPrompt));
    },
    [applyTrace],
  );

  const loadDemo = useCallback(() => {
    beginTrace(DEMO_PROMPT);
  }, [beginTrace]);

  const runLive = useCallback(async () => {
    const nextPrompt = prompt.trim() || DEMO_PROMPT;
    if (auth.mode === "scripted") {
      beginTrace(nextPrompt);
      return;
    }
    if (auth.mode === "byok" && !auth.byokKey.trim()) {
      setRunError("Add an API key in Credentials, or switch to scripted demo.");
      return;
    }

    stopContinue();
    setLiveBusy(true);
    setRunError(null);
    setMode("running");

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: nextPrompt,
          mode: auth.mode === "byok" ? "byok" : "portfolio",
          provider: auth.byokProvider,
          apiKey: auth.mode === "byok" ? auth.byokKey.trim() : undefined,
        }),
      });
      const data = (await res.json()) as {
        trace?: HermesTrace;
        error?: string | null;
      };
      if (!res.ok || !data.trace) {
        throw new Error(data.error || `Run failed (${res.status})`);
      }
      if (data.error) setRunError(data.error);
      applyTrace(data.trace);
    } catch (e) {
      setMode("stopped");
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setLiveBusy(false);
    }
  }, [auth, applyTrace, beginTrace, prompt, stopContinue]);

  const runFromPrompt = useCallback(() => {
    void runLive();
  }, [runLive]);

  const onStepInto = useCallback(() => {
    stopContinue();
    setMode("paused");
    setIndex((i) => stepInto(i, trace.events));
  }, [stopContinue, trace.events]);

  const onStepOver = useCallback(() => {
    stopContinue();
    setMode("paused");
    setIndex((i) => stepOver(i, trace.events));
  }, [stopContinue, trace.events]);

  const onContinue = useCallback(() => {
    stopContinue();
    if (trace.events.length === 0) return;

    setMode("running");
    setIndex((i) => (i < 0 ? 0 : i));

    timerRef.current = setInterval(() => {
      setIndex((i) => {
        const next = stepInto(i < 0 ? -1 : i, trace.events);
        const end = continueTarget(trace.events);
        if (next >= end) {
          stopContinue();
          setMode("paused");
          return end;
        }
        return next;
      });
    }, CONTINUE_MS);
  }, [stopContinue, trace.events]);

  const onStop = useCallback(() => {
    stopContinue();
    setMode("paused");
  }, [stopContinue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "F5") {
        e.preventDefault();
        if (mode === "running") onStop();
        else onContinue();
      } else if (e.key === "F10") {
        e.preventDefault();
        onStepOver();
      } else if (e.key === "F11") {
        e.preventDefault();
        onStepInto();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onStop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onContinue, onStepInto, onStepOver, onStop]);

  useEffect(() => () => stopContinue(), [stopContinue]);

  useEffect(() => {
    setIndex(0);
    setMode("paused");
  }, []);

  const atEnd = index >= trace.events.length - 1 && index >= 0;
  const atStart = index <= 0;
  const progressPct =
    trace.events.length > 0 && index >= 0
      ? Math.round(((index + 1) / trace.events.length) * 100)
      : 0;

  const statusLabel = liveBusy
    ? "Calling model…"
    : mode === "running"
      ? "Playing…"
      : atEnd
        ? "Finished"
        : index < 0
          ? "Idle"
          : "Paused — ready to step";

  const runLabel =
    auth.mode === "scripted"
      ? "Load trace"
      : liveBusy
        ? "Running…"
        : "Run live";

  const jumpToStage = useCallback(
    (stageId: (typeof STAGES)[number]["id"]) => {
      const i = trace.events.findIndex((e) => e.stage === stageId);
      if (i < 0) return;
      stopContinue();
      setMode("paused");
      setIndex(i);
    },
    [stopContinue, trace.events],
  );

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-brand">
          <h1>hermes-xray</h1>
          <span>
            Watch a prompt move through Hermes — one debugger step at a time
          </span>
        </div>
        <div className="titlebar-right">
          <SiteNav />
          <div className="titlebar-meta">
            <span title="Model for this run / selected mode">{displayModel}</span>
            <span title="Platform / provider">{displayPlatform}</span>
            <span title="Current event in the trace">
              step {index < 0 ? "—" : `${index + 1} / ${trace.events.length}`}
            </span>
          </div>
        </div>
      </header>

      <div className="start-here" aria-label="How to use">
        <div className="start-here-title">Start here</div>
        <ol className="start-here-steps">
          <li>
            <strong>1.</strong> Pick <em>This site&apos;s Gemini</em> for a free
            live test (visitors need no key), or stay on offline demo.
          </li>
          <li>
            <strong>2.</strong> Enter your prompt, then click{" "}
            <em>{auth.mode === "scripted" ? "Load trace" : "Run live"}</em>.
          </li>
          <li>
            <strong>3.</strong> Press <kbd>F11</kbd> to step one event at a
            time.
          </li>
        </ol>
      </div>

      <AuthPanel
        settings={auth}
        onChange={setAuth}
        onStatus={onAuthStatus}
      />

      {!portfolioReady && auth.mode !== "byok" ? (
        <div className="keys-banner">
          Site Gemini is off until <code>GEMINI_API_KEY</code> is set on the
          server. You can still use the offline demo or paste your own key.
        </div>
      ) : null}

      <div className="control-bar">
        <form
          className="prompt-row"
          onSubmit={(e) => {
            e.preventDefault();
            runFromPrompt();
          }}
        >
          <label htmlFor="prompt">Your prompt</label>
          <input
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            spellCheck={false}
            aria-label="User prompt"
            disabled={liveBusy}
            placeholder="e.g. What's in README.md, then summarize it."
          />
          <button
            type="submit"
            className="run-submit"
            disabled={liveBusy}
            title={
              auth.mode === "scripted"
                ? "Build a stepped demo trace from this prompt"
                : "Call the model, then step through the resulting trace"
            }
          >
            {runLabel}
          </button>
        </form>
        <div className="toolbar-wrap">
          <div className="toolbar">
            <button
              type="button"
              onClick={loadDemo}
              title="Reset to the README demo prompt and scripted trace"
              disabled={liveBusy}
            >
              <span className="label">Demo prompt</span>
            </button>
            <button
              type="button"
              className="primary"
              onClick={onStepInto}
              disabled={liveBusy || atEnd}
              title="Step Into (F11) — go forward by one event (best for learning)"
            >
              <span className="label">Next event</span>
              <kbd>F11</kbd>
            </button>
            <button
              type="button"
              onClick={onStepOver}
              disabled={liveBusy || atEnd}
              title="Step Over (F10) — skip nested detail; jump to next broader stage"
            >
              <span className="label">Skip detail</span>
              <kbd>F10</kbd>
            </button>
            <button
              type="button"
              onClick={mode === "running" ? onStop : onContinue}
              disabled={liveBusy || (atEnd && mode !== "running")}
              title="Continue (F5) — auto-play every remaining event"
            >
              <span className="label">
                {mode === "running" && !liveBusy ? "Pause" : "Play all"}
              </span>
              <kbd>F5</kbd>
            </button>
            <button
              type="button"
              onClick={reset}
              title="Reset — clear progress back to before the first event"
              disabled={liveBusy || (atStart && mode === "stopped")}
            >
              <span className="label">Reset</span>
            </button>
          </div>
          <span className={`status-chip ${liveBusy || mode === "running" ? "running" : atEnd ? "stopped" : mode}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="command-help" aria-label="Debugger command guide">
        <div className="command-help-item">
          <kbd>F11</kbd>
          <span>
            <strong>Next event</strong> — one step forward (see every nested
            tool call).
          </span>
        </div>
        <div className="command-help-item">
          <kbd>F10</kbd>
          <span>
            <strong>Skip detail</strong> — jump ahead past nested events to
            the next broader stage.
          </span>
        </div>
        <div className="command-help-item">
          <kbd>F5</kbd>
          <span>
            <strong>Play all</strong> — auto-runs to the end (press again to
            pause).
          </span>
        </div>
      </div>

      {runError ? <div className="run-error">{runError}</div> : null}

      <div className="now-bar" aria-live="polite">
        <div className="now-main">
          <span className="now-label">You are here</span>
          {snapshot.event ? (
            <span className="now-summary">
              {snapshot.event.iteration != null
                ? `Loop #${snapshot.event.iteration} → `
                : ""}
              {eventTypeLabel(snapshot.event.type)}
              <span className="now-sep">·</span>
              {snapshot.event.summary}
            </span>
          ) : (
            <span className="now-summary">
              Load a trace, then press F11 to take the first step.
            </span>
          )}
        </div>
        <div className="now-progress" title={`${progressPct}% of trace`}>
          <div className="now-progress-track">
            <div
              className="now-progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="now-progress-text">
            {index < 0 ? "0%" : `${progressPct}%`}
          </span>
        </div>
      </div>

      <div className="pipeline" aria-label="Hermes pipeline stages">
        {STAGES.map((stage) => {
          const active = snapshot.activeStage === stage.id;
          const visited = visitedStages.has(stage.id);
          const reachable = trace.events.some((e) => e.stage === stage.id);
          return (
            <button
              key={stage.id}
              type="button"
              className={`pipeline-node${active ? " active" : ""}${visited && !active ? " visited" : ""}`}
              onClick={() => jumpToStage(stage.id)}
              disabled={!reachable}
              title={
                reachable
                  ? `Jump to first “${stage.label}” event`
                  : "Not in this trace yet"
              }
            >
              <span className="num">{stage.num}</span>
              <span className="title">{stage.label}</span>
              <span className="mini">{stage.detail}</span>
            </button>
          );
        })}
      </div>

      <div className="panes">
        <section className="pane stack" aria-label="Call stack">
          <div className="pane-header">
            <div>
              <h2>Where you are</h2>
              <p className="pane-sub">Call stack · nested Hermes stages</p>
            </div>
          </div>
          <div className="pane-body">
            {snapshot.stack.length === 0 ? (
              <p className="empty-hint">
                Stack frames appear as you step. Press F11 to begin.
              </p>
            ) : (
              <ul className="stack-list">
                {snapshot.stack.map((frame, i) => (
                  <li
                    key={`${frame.label}-${i}`}
                    className={frame.active ? "active" : undefined}
                  >
                    <span className="frame-label">{frame.label}</span>
                    <span className="frame-meta">
                      {frame.module} · {frame.symbol}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="pane watches" aria-label="Locals and watches">
          <div className="pane-header">
            <div>
              <h2>What changed</h2>
              <p className="pane-sub">
                Locals · tools, args, stop reason, messages
              </p>
            </div>
          </div>
          <div className="pane-body">
            <div className="watch-grid">
              <Watch k="prompt" v={snapshot.watches.prompt} />
              <Watch
                k="loop #"
                v={
                  snapshot.watches.iteration == null
                    ? "—"
                    : `${snapshot.watches.iteration} / ${snapshot.watches.maxIterations}`
                }
              />
              <Watch
                k="budget left"
                v={
                  snapshot.watches.budgetRemaining == null
                    ? "—"
                    : String(snapshot.watches.budgetRemaining)
                }
              />
              <Watch k="stop reason" v={String(snapshot.watches.stopReason)} />
              <Watch
                k="finish reason"
                v={snapshot.watches.finishReason ?? "—"}
              />
              <Watch
                k="tools used"
                v={
                  snapshot.watches.selectedTools.length
                    ? snapshot.watches.selectedTools.join(", ")
                    : "—"
                }
                className="tool"
              />
              <Watch
                k="last tool args"
                v={
                  snapshot.watches.lastToolArgs
                    ? JSON.stringify(snapshot.watches.lastToolArgs, null, 0)
                    : "—"
                }
                className="tool"
              />
              <Watch
                k="last tool result"
                v={
                  snapshot.watches.lastToolResult
                    ? truncate(
                        JSON.stringify(snapshot.watches.lastToolResult),
                        160,
                      )
                    : "—"
                }
                className="tool"
              />
              <Watch
                k="tools available"
                v={
                  snapshot.watches.availableTools.length
                    ? snapshot.watches.availableTools.join(", ")
                    : "—"
                }
              />
              <Watch
                k="messages saved"
                v={String(snapshot.watches.messageCount)}
              />
              <Watch
                k="~prompt tokens"
                v={
                  snapshot.watches.estimatedPromptTokens == null
                    ? "—"
                    : String(snapshot.watches.estimatedPromptTokens)
                }
              />
            </div>

            {snapshot.watches.finalResponse ? (
              <div className="watch-section">
                <h3>Final answer</h3>
                <div className="watch-row">
                  <span className="key">assistant</span>
                  <span className="val ok">
                    {snapshot.watches.finalResponse}
                  </span>
                </div>
              </div>
            ) : null}

            {snapshot.watches.messages.length > 0 ? (
              <div className="watch-section">
                <h3>Message trail</h3>
                <ul className="message-list">
                  {snapshot.watches.messages.map((m, i) => (
                    <li key={`${m.role}-${i}`}>
                      <span className={`role ${m.role}`}>{m.role}</span>
                      {truncate(m.preview, 140)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        <section className="pane source" aria-label="Source and stage detail">
          <div className="pane-header">
            <div>
              <h2>Hermes code</h2>
              <p className="pane-sub">
                Which module owns this step
              </p>
            </div>
          </div>
          <div className="pane-body">
            {!snapshot.event ? (
              <p className="empty-hint">
                Source landmarks show up once you step into an event.
              </p>
            ) : (
              <div className="source-block">
                <div className="source-path">{snapshot.event.module.path}</div>
                <div className="source-symbol">
                  {snapshot.event.module.symbol}
                </div>
                <div className="source-role">{snapshot.event.module.role}</div>
                <pre className="source-code">{sourceSnippet(snapshot.event)}</pre>
                {snapshot.event.payload ? (
                  <div className="source-payload">
                    <div className="pane-header" style={{ margin: "0 0 6px" }}>
                      <h2>Raw event data</h2>
                    </div>
                    <pre>
                      {JSON.stringify(snapshot.event.payload, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <section className="pane timeline" aria-label="Event timeline">
          <div className="pane-header">
            <div>
              <h2>Event log</h2>
              <p className="pane-sub">Click any row to jump there</p>
            </div>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--text-faint)",
              }}
            >
              {snapshot.visibleEvents.length} shown
            </span>
          </div>
          <div className="pane-body">
            {snapshot.visibleEvents.length === 0 ? (
              <p className="empty-hint">
                The timeline fills in as you step forward.
              </p>
            ) : (
              <ul className="timeline-list">
                {snapshot.visibleEvents.map((ev, i) => (
                  <li
                    key={ev.id}
                    className={`timeline-item${i === snapshot.index ? " active" : ""}`}
                    onClick={() => {
                      stopContinue();
                      setMode("paused");
                      setIndex(i);
                    }}
                  >
                    <span className="ts">{formatTs(ev.ts)}</span>
                    <span className="type" data-kind={ev.type}>
                      {eventTypeLabel(ev.type)}
                    </span>
                    <span className="summary" title={ev.summary}>
                      {ev.iteration != null ? `#${ev.iteration} · ` : ""}
                      {ev.summary}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Watch({
  k,
  v,
  className,
}: {
  k: string;
  v: string;
  className?: string;
}) {
  return (
    <div className="watch-row">
      <span className="key">{k}</span>
      <span className={`val${className ? ` ${className}` : ""}`}>{v}</span>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function sourceSnippet(event: {
  type: string;
  stage: string;
  module: { path: string; symbol: string };
  iteration?: number;
  summary: string;
}): string {
  const iter =
    event.iteration != null ? `  # iteration ${event.iteration}\n` : "";
  switch (event.stage) {
    case "inbound":
      return `${iter}# ${event.module.path}
source = SessionSource(platform="cli", chat_id="local")
session_key = build_session_key(source)
# inbound prompt bound → ${event.summary}`;
    case "hydrate":
      return `${iter}# ${event.module.path}
parts = build_system_prompt_parts(agent, history)
messages = hydrate_session(session_db, session_id)
# context ready for run_conversation()`;
    case "model":
      return `${iter}# ${event.module.path}
while api_call_count < agent.max_iterations:
    response = provider.chat_completion(messages, tools)
    finish_reason = response.finish_reason
    # ${event.summary}`;
    case "tool_resolve":
      return `${iter}# ${event.module.path}
schema = registry.get_schema(name)
defs = registry.get_definitions(tool_names)
# ${event.summary}`;
    case "tool_execute":
      return `${iter}# ${event.module.path}
execute_tool_calls_sequential(agent, assistant_message, messages)
result = registry.dispatch(name, args)
# ${event.summary}`;
    case "persist":
      return `${iter}# ${event.module.path}
agent._persist_session(messages, conversation_history)
SessionDB.append_message(session_id, role, content)
# ${event.summary}`;
    case "loop_decision":
      return `${iter}# ${event.module.path}
if finish_reason == "tool_calls" and budget.remaining > 0:
    continue  # → model turn
else:
    return final_response  # agent_end
# ${event.summary}`;
    default:
      return `${iter}# ${event.module.path}\n# ${event.module.symbol}\n# ${event.summary}`;
  }
}

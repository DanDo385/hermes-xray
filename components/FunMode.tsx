"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthPanel, useAuthSettings } from "@/components/AuthPanel";
import { SiteNav } from "@/components/SiteNav";
import { DEMO_PROMPT } from "@/lib/demo-trace";
import type { HermesTrace } from "@/lib/events";
import { getScriptedTrace } from "@/lib/live-adapter";
import {
  groupBeatsByLoop,
  narrateTrace,
  type StoryBeat,
} from "@/lib/fun-narration";

const REVEAL_MS = 520;

export function FunMode() {
  const [prompt, setPrompt] = useState(DEMO_PROMPT);
  const [auth, setAuth] = useAuthSettings();
  const [trace, setTrace] = useState<HermesTrace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const beats = useMemo(
    () => (trace ? narrateTrace(trace) : []),
    [trace],
  );
  const grouped = useMemo(() => groupBeatsByLoop(beats), [beats]);

  const stopReveal = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }, []);

  const startReveal = useCallback(
    (all: StoryBeat[]) => {
      stopReveal();
      setVisibleCount(0);
      if (all.length === 0) return;
      setPlaying(true);
      let i = 0;
      timerRef.current = setInterval(() => {
        i += 1;
        setVisibleCount(i);
        if (i >= all.length) {
          stopReveal();
        }
      }, REVEAL_MS);
    },
    [stopReveal],
  );

  useEffect(() => () => stopReveal(), [stopReveal]);

  const applyTrace = useCallback(
    (next: HermesTrace) => {
      setTrace(next);
      setPrompt(next.prompt);
      const nextBeats = narrateTrace(next);
      startReveal(nextBeats);
    },
    [startReveal],
  );

  const run = useCallback(async () => {
    const nextPrompt = prompt.trim() || DEMO_PROMPT;
    setError(null);

    if (auth.mode === "scripted") {
      applyTrace(getScriptedTrace(nextPrompt));
      return;
    }
    if (auth.mode === "byok" && !auth.byokKey.trim()) {
      setError("Add an API key above, or switch to Offline demo / Site Gemini.");
      return;
    }

    setBusy(true);
    stopReveal();
    setTrace(null);
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
      if (data.error) setError(data.error);
      applyTrace(data.trace);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [auth, applyTrace, prompt, stopReveal]);

  const visibleBeats = beats.slice(0, visibleCount);
  const visibleIds = new Set(visibleBeats.map((b) => b.id));

  return (
    <div className="fun-shell">
      <header className="fun-header">
        <div className="fun-header-top">
          <div>
            <h1>hermes-xray · fun mode</h1>
            <p>
              Plain English: watch the prompt get analyzed, reason out loud,
              loop through tool turns, and land on a final answer.
            </p>
          </div>
          <SiteNav />
        </div>
      </header>

      <AuthPanel settings={auth} onChange={setAuth} />

      <div className="fun-controls">
        <form
          className="prompt-row"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <label htmlFor="fun-prompt">Your prompt</label>
          <input
            id="fun-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            spellCheck={false}
            placeholder="Ask something Hermes can investigate…"
          />
          <button type="submit" className="run-submit" disabled={busy}>
            {busy
              ? "Thinking…"
              : auth.mode === "scripted"
                ? "Tell the story"
                : "Run & narrate"}
          </button>
        </form>
        {trace ? (
          <div className="fun-playback">
            <button
              type="button"
              onClick={() => startReveal(beats)}
              disabled={playing || busy}
            >
              Replay story
            </button>
            <button type="button" onClick={stopReveal} disabled={!playing}>
              Pause
            </button>
            <button
              type="button"
              onClick={() => {
                stopReveal();
                setVisibleCount(beats.length);
              }}
              disabled={busy}
            >
              Show all
            </button>
            <span className="fun-progress">
              {visibleCount}/{beats.length} beats
              {playing ? " · playing" : ""}
            </span>
          </div>
        ) : null}
      </div>

      {error ? <div className="run-error">{error}</div> : null}

      <div className="fun-timeline" aria-live="polite">
        {!trace ? (
          <p className="fun-empty">
            Pick Offline demo or This site&apos;s Gemini — then hit{" "}
            <strong>Tell the story</strong>. A visitor API key is optional.
            Boxes appear as each turn unfolds.
          </p>
        ) : (
          <>
            {grouped.prep.some((b) => visibleIds.has(b.id)) ? (
              <section className="fun-act">
                <h2>Before the loop</h2>
                <div className="fun-boxes">
                  {grouped.prep
                    .filter((b) => visibleIds.has(b.id))
                    .map((b) => (
                      <StoryBox key={b.id} beat={b} />
                    ))}
                </div>
              </section>
            ) : null}

            {grouped.loops.map(({ iteration, beats: loopBeats }) => {
              const shown = loopBeats.filter((b) => visibleIds.has(b.id));
              if (shown.length === 0) return null;
              return (
                <section key={iteration} className="fun-act fun-loop">
                  <h2>
                    <span className="fun-loop-badge">loop #{iteration}</span>
                    Time winds forward again
                  </h2>
                  <div className="fun-boxes">
                    {shown.map((b) => (
                      <StoryBox key={b.id} beat={b} />
                    ))}
                  </div>
                  {shown.some((b) => b.turnEnd) ? (
                    <div className="fun-loop-end">End of turn #{iteration}</div>
                  ) : null}
                </section>
              );
            })}

            {grouped.finale.some((b) => visibleIds.has(b.id)) ? (
              <section className="fun-act fun-finale-act">
                <h2>The last response</h2>
                <div className="fun-boxes">
                  {grouped.finale
                    .filter((b) => visibleIds.has(b.id))
                    .map((b) => (
                      <StoryBox key={b.id} beat={b} highlight={b.finale} />
                    ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function StoryBox({
  beat,
  highlight,
}: {
  beat: StoryBeat;
  highlight?: boolean;
}) {
  return (
    <article
      className={`fun-box kind-${beat.kind}${highlight || beat.finale ? " finale" : ""}`}
    >
      <div className="fun-box-title">{beat.title}</div>
      <p className="fun-box-body">{beat.body}</p>
    </article>
  );
}

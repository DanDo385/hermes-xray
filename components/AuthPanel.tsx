"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_AUTH,
  loadAuthSettings,
  maskKey,
  PROVIDER_LABELS,
  saveAuthSettings,
  type AuthSettings,
  type InferenceMode,
  type InferenceProvider,
} from "@/lib/auth-settings";

interface StatusPayload {
  portfolioGemini: boolean;
  portfolioModel: string;
  oauth: { chatgpt: boolean; supergrok: boolean; reason: string };
}

export function AuthPanel({
  settings,
  onChange,
  onStatus,
}: {
  settings: AuthSettings;
  onChange: (next: AuthSettings) => void;
  onStatus?: (status: StatusPayload | null) => void;
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((data: StatusPayload) => {
        if (!cancelled) {
          setStatus(data);
          onStatus?.(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(null);
          onStatus?.(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onStatus]);

  const update = (patch: Partial<AuthSettings>) => {
    const next = { ...settings, ...patch };
    saveAuthSettings(next);
    onChange(next);
  };

  const selectMode = (mode: InferenceMode) => update({ mode });

  const portfolioReady = status?.portfolioGemini === true;
  const portfolioModel = status?.portfolioModel ?? "gemini-2.0-flash-lite";

  return (
    <section className="keys-panel" aria-label="API keys and live test">
      <div className="keys-panel-head">
        <div>
          <h2>Analyze your own prompt</h2>
          <p>
            Use this site&apos;s cheapest Google Gemini model for a quick live
            test, or paste your own API key. The offline demo never calls a
            model (that&apos;s why the top bar may say{" "}
            <code>scripted-demo</code>).
          </p>
        </div>
      </div>

      <div className="keys-grid">
        <button
          type="button"
          className={`keys-card${settings.mode === "scripted" ? " selected" : ""}`}
          onClick={() => selectMode("scripted")}
        >
          <span className="keys-card-kicker">No API</span>
          <span className="keys-card-title">Offline demo</span>
          <span className="keys-card-body">
            Replay a canned Hermes trace. Good for learning the debugger
            without spending quota.
          </span>
        </button>

        <button
          type="button"
          className={`keys-card${settings.mode === "portfolio" ? " selected" : ""}${!portfolioReady ? " disabled" : ""}`}
          onClick={() => portfolioReady && selectMode("portfolio")}
          disabled={!portfolioReady}
          title={
            portfolioReady
              ? `Run on ${portfolioModel} via the portfolio Gemini key`
              : "Set GEMINI_API_KEY on the server to enable this"
          }
        >
          <span className="keys-card-kicker">Recommended test</span>
          <span className="keys-card-title">
            Site Gemini · {portfolioModel}
          </span>
          <span className="keys-card-body">
            {portfolioReady
              ? "Uses the portfolio owner’s Google free-tier key on the cheapest model. Key never leaves the server."
              : "Not configured yet — add GEMINI_API_KEY on the host, then refresh."}
          </span>
        </button>

        <button
          type="button"
          className={`keys-card${settings.mode === "byok" ? " selected" : ""}`}
          onClick={() => selectMode("byok")}
        >
          <span className="keys-card-kicker">Bring your own</span>
          <span className="keys-card-title">Your API key</span>
          <span className="keys-card-body">
            Paste a Google, OpenAI, or xAI key to analyze your prompt with your
            own quota. Stored only in this browser.
          </span>
        </button>
      </div>

      {settings.mode === "byok" ? (
        <div className="keys-byok">
          <label className="auth-field">
            <span>Provider</span>
            <select
              value={settings.byokProvider}
              onChange={(e) =>
                update({
                  byokProvider: e.target.value as InferenceProvider,
                })
              }
            >
              {(Object.keys(PROVIDER_LABELS) as InferenceProvider[]).map(
                (p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="auth-field">
            <span>API key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste API key — stays in this browser only"
              value={settings.byokKey}
              onChange={(e) => update({ byokKey: e.target.value })}
            />
          </label>
          {settings.byokKey ? (
            <div className="auth-masked">
              saved locally as {maskKey(settings.byokKey)}
            </div>
          ) : (
            <div className="auth-masked">
              After pasting a key, type your prompt below and click{" "}
              <strong>Run live</strong>.
            </div>
          )}
        </div>
      ) : null}

      {settings.mode === "portfolio" && portfolioReady ? (
        <p className="auth-ok">
          Live test ready · {portfolioModel} · type your prompt and click{" "}
          <strong>Run live</strong>
        </p>
      ) : null}

      {settings.mode === "scripted" ? (
        <p className="keys-hint">
          Offline mode selected · click <strong>Load trace</strong> then step
          with F11. Switch to Site Gemini or Your API key to analyze a custom
          prompt for real.
        </p>
      ) : null}
    </section>
  );
}

export function useAuthSettings(): [
  AuthSettings,
  (next: AuthSettings) => void,
] {
  const [settings, setSettings] = useState<AuthSettings>(DEFAULT_AUTH);

  useEffect(() => {
    setSettings(loadAuthSettings());
  }, []);

  const setAndPersist = (next: AuthSettings) => {
    saveAuthSettings(next);
    setSettings(next);
  };

  return [settings, setAndPersist];
}

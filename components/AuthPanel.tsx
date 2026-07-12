"use client";

import { useEffect, useState } from "react";
import { ApiKeySecurity } from "@/components/ApiKeySecurity";
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
        if (cancelled) return;
        setStatus(data);
        onStatus?.(data);
        // If they wanted hosted demo but the server key isn't set, fall back.
        if (!data.portfolioGemini && settings.mode === "portfolio") {
          const next = { ...settings, mode: "scripted" as const };
          saveAuthSettings(next);
          onChange(next);
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
    // intentionally run once on mount for status + fallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <h2>Try a live prompt</h2>
          <p>
            Visitors are meant to use <strong>this site&apos;s Gemini</strong>{" "}
            — it runs on the host&apos;s free-tier key on the server. You never
            see, copy, or download that key. Offline demo needs no model. A
            visitor-supplied key is optional and rare.
          </p>
        </div>
      </div>

      <div className="keys-grid">
        <button
          type="button"
          className={`keys-card${settings.mode === "portfolio" ? " selected" : ""}${!portfolioReady ? " disabled" : ""}`}
          onClick={() => portfolioReady && selectMode("portfolio")}
          disabled={!portfolioReady}
          title={
            portfolioReady
              ? `Run on ${portfolioModel} — host key stays on the server`
              : "Set GEMINI_API_KEY on the server to enable this"
          }
        >
          <span className="keys-card-kicker">Use this (recommended)</span>
          <span className="keys-card-title">
            This site&apos;s Gemini · {portfolioModel}
          </span>
          <span className="keys-card-body">
            {portfolioReady
              ? "Live demo powered by the host’s Google free-tier key. The key never leaves the server — visitors only trigger a run."
              : "Host hasn’t set GEMINI_API_KEY yet. Offline demo still works."}
          </span>
        </button>

        <button
          type="button"
          className={`keys-card${settings.mode === "scripted" ? " selected" : ""}`}
          onClick={() => selectMode("scripted")}
        >
          <span className="keys-card-kicker">No API</span>
          <span className="keys-card-title">Offline demo</span>
          <span className="keys-card-body">
            Replay a canned Hermes trace. No network, no quota.
          </span>
        </button>

        <button
          type="button"
          className={`keys-card${settings.mode === "byok" ? " selected" : ""}`}
          onClick={() => selectMode("byok")}
        >
          <span className="keys-card-kicker">Advanced · optional</span>
          <span className="keys-card-title">Visitor&apos;s own API key</span>
          <span className="keys-card-body">
            Only if someone prefers their own Google / OpenAI / xAI quota.
            Not needed for the normal demo. Stored in their browser only.
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
          Hosted demo ready · {portfolioModel} · host key stays on the server ·
          type a prompt and click <strong>Run live</strong>
        </p>
      ) : null}

      {settings.mode === "scripted" ? (
        <p className="keys-hint">
          Offline mode selected · click <strong>Load trace</strong> then step
          with F11. Switch to <strong>This site&apos;s Gemini</strong> when you
          want a real live run on the host key (still never shown in the
          browser).
        </p>
      ) : null}

      <ApiKeySecurity
        byokKey={settings.mode === "byok" ? settings.byokKey : ""}
        compact
      />
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

"use client";

import { useMemo, useState } from "react";

const WARNINGS = [
  "This site’s Gemini demo is meant to be used - it spends the host’s free-tier quota on the server.",
  "The host API key is never sent to your browser, shown in the UI, or downloadable. You only trigger a run.",
  "Do not ask the host to paste or share their key. If someone sends you a key in chat, tell them to revoke it.",
  "Optional visitor keys are advanced only. Treat any pasted key like a password - never commit or screenshot it.",
  "If a key may have leaked, revoke it in the provider console and create a new one.",
];

/** Lightweight client-side checks - not a substitute for provider-side revocation. */
export function checkApiKeySafety(key: string): {
  ok: boolean;
  messages: string[];
} {
  const t = key.trim();
  const messages: string[] = [];
  if (!t) return { ok: true, messages: [] };

  if (/\s/.test(t)) {
    messages.push("This key contains spaces - paste only the key, nothing else.");
  }
  if (t.length < 20) {
    messages.push("This looks shorter than a typical API key. Double-check the paste.");
  }
  if (/^(password|secret|apikey|api_key)$/i.test(t)) {
    messages.push("That does not look like a real API key.");
  }
  if (/https?:\/\//i.test(t) || t.includes("@")) {
    messages.push("Do not paste URLs or emails into the key field.");
  }
  if (/^(here'?s my|my key is|sk-…|xxxx)/i.test(t)) {
    messages.push("Paste the raw key only - no commentary.");
  }

  return { ok: messages.length === 0, messages };
}

export function ApiKeySecurity({
  byokKey = "",
  compact = false,
}: {
  byokKey?: string;
  compact?: boolean;
}) {
  const [acked, setAcked] = useState(false);
  const checks = useMemo(() => checkApiKeySafety(byokKey), [byokKey]);

  return (
    <aside
      className={`key-security${compact ? " compact" : ""}`}
      aria-label="API key security warnings"
    >
      <div className="key-security-title">Keys stay secret</div>
      <ul className="key-security-list">
        {WARNINGS.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>

      {checks.messages.length > 0 ? (
        <div className="key-security-checks" role="alert">
          <strong>Key check:</strong>
          <ul>
            {checks.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <label className="key-security-ack">
        <input
          type="checkbox"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        <span>
          I understand the hosted demo never reveals the host key, and any
          optional visitor key I paste must not be shared.
        </span>
      </label>
      {!acked ? (
        <p className="key-security-nudge">
          Acknowledge before pasting an optional visitor key. Hosted Gemini
          needs no paste.
        </p>
      ) : (
        <p className="key-security-ok">Security reminder acknowledged.</p>
      )}
    </aside>
  );
}

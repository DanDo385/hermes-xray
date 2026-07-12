/** Credential / inference mode for hermes-xray live runs. */

export type InferenceProvider = "google" | "openai" | "xai";

export type InferenceMode =
  /** Replay scripted HermesEvent trace — no network */
  | "scripted"
  /** Server uses portfolio GEMINI_API_KEY (never exposed to browser) */
  | "portfolio"
  /** Visitor supplies their own provider API key (localStorage) */
  | "byok";

export interface AuthSettings {
  mode: InferenceMode;
  byokProvider: InferenceProvider;
  /** Present only in memory / localStorage — never logged server-side intentionally */
  byokKey: string;
}

export const AUTH_STORAGE_KEY = "hermes-xray-auth-v1";

export const PROVIDER_LABELS: Record<InferenceProvider, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  xai: "xAI (Grok)",
};

export const DEFAULT_AUTH: AuthSettings = {
  // Prefer hosted Gemini so portfolio visitors run live demos on the host key
  // (never exposed to the browser). Falls back to scripted if unset.
  mode: "portfolio",
  byokProvider: "google",
  byokKey: "",
};

export function loadAuthSettings(): AuthSettings {
  if (typeof window === "undefined") return { ...DEFAULT_AUTH };
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTH };
    const parsed = JSON.parse(raw) as Partial<AuthSettings>;
    return {
      mode:
        parsed.mode === "portfolio" ||
        parsed.mode === "byok" ||
        parsed.mode === "scripted"
          ? parsed.mode
          : "scripted",
      byokProvider:
        parsed.byokProvider === "openai" ||
        parsed.byokProvider === "xai" ||
        parsed.byokProvider === "google"
          ? parsed.byokProvider
          : "google",
      byokKey: typeof parsed.byokKey === "string" ? parsed.byokKey : "",
    };
  } catch {
    return { ...DEFAULT_AUTH };
  }
}

export function saveAuthSettings(settings: AuthSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      mode: settings.mode,
      byokProvider: settings.byokProvider,
      byokKey: settings.byokKey,
    }),
  );
}

export function maskKey(key: string): string {
  const t = key.trim();
  if (t.length < 8) return t ? "••••" : "";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

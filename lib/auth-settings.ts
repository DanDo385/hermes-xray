/** Credential / inference mode for hermes-xray live runs. */

export const INFERENCE_PROVIDERS = [
  "google",
  "openai",
  "anthropic",
  "xai",
  "openrouter",
  "huggingface",
] as const;

export type InferenceProvider = (typeof INFERENCE_PROVIDERS)[number];

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
  /** Optional model override for BYOK (empty = provider default) */
  byokModel: string;
  /** Present only in memory / localStorage — never logged server-side intentionally */
  byokKey: string;
}

export const AUTH_STORAGE_KEY = "hermes-xray-auth-v1";

export const PROVIDER_LABELS: Record<InferenceProvider, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  xai: "xAI (Grok)",
  openrouter: "OpenRouter",
  huggingface: "Hugging Face",
};

export const PROVIDER_KEY_HINTS: Record<InferenceProvider, string> = {
  google: "AI Studio key (often starts with AIza…)",
  openai: "OpenAI key (sk-…)",
  anthropic: "Anthropic key (sk-ant-…)",
  xai: "xAI key (xai-…)",
  openrouter: "OpenRouter key (sk-or-…)",
  huggingface: "HF token (hf_…)",
};

export const PROVIDER_DEFAULT_MODELS: Record<InferenceProvider, string> = {
  google: "gemini-3.1-flash-lite-preview",
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5",
  xai: "grok-2-latest",
  openrouter: "openai/gpt-4o-mini",
  huggingface: "Qwen/Qwen2.5-7B-Instruct",
};

export const DEFAULT_AUTH: AuthSettings = {
  // Prefer hosted Gemini so portfolio visitors run live demos on the host key
  // (never exposed to the browser). Falls back to scripted if unset.
  mode: "portfolio",
  byokProvider: "google",
  byokModel: "",
  byokKey: "",
};

export function isInferenceProvider(value: unknown): value is InferenceProvider {
  return (
    typeof value === "string" &&
    (INFERENCE_PROVIDERS as readonly string[]).includes(value)
  );
}

/** Best-effort guess from common key prefixes — UI still lets the user override. */
export function guessProviderFromKey(key: string): InferenceProvider | null {
  const k = key.trim();
  if (!k) return null;
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("xai-")) return "xai";
  if (k.startsWith("hf_")) return "huggingface";
  if (k.startsWith("AIza")) return "google";
  if (k.startsWith("sk-")) return "openai";
  return null;
}

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
      byokProvider: isInferenceProvider(parsed.byokProvider)
        ? parsed.byokProvider
        : "google",
      byokModel:
        typeof parsed.byokModel === "string" ? parsed.byokModel : "",
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
      byokModel: settings.byokModel,
      byokKey: settings.byokKey,
    }),
  );
}

export function maskKey(key: string): string {
  const t = key.trim();
  if (t.length < 8) return t ? "••••" : "";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

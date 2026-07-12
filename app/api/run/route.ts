import { NextResponse } from "next/server";
import {
  defaultModelForProvider,
  defaultPortfolioModel,
  portfolioApiKey,
  runLiveAgent,
} from "@/lib/agent-runner";
import type { InferenceProvider } from "@/lib/auth-settings";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  prompt?: string;
  mode?: "portfolio" | "byok";
  provider?: InferenceProvider;
  apiKey?: string;
  model?: string;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited = rateLimit(`run:${ip}`, 20, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded. Try again in ${limited.retryAfterSec}s.`,
      },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return NextResponse.json(
      { error: "prompt too long (max 2000 chars)" },
      { status: 400 },
    );
  }

  const mode = body.mode === "byok" ? "byok" : "portfolio";

  let provider: InferenceProvider = "google";
  let apiKey: string | null = null;
  let model: string;

  if (mode === "portfolio") {
    apiKey = portfolioApiKey();
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Portfolio Gemini key is not configured. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in the server environment, or switch to Bring your own key.",
        },
        { status: 503 },
      );
    }
    provider = "google";
    model = body.model?.trim() || defaultPortfolioModel();
  } else {
    provider =
      body.provider === "openai" || body.provider === "xai"
        ? body.provider
        : "google";
    apiKey = body.apiKey?.trim() || null;
    if (!apiKey) {
      return NextResponse.json(
        { error: "apiKey is required for BYOK mode" },
        { status: 400 },
      );
    }
    model = body.model?.trim() || defaultModelForProvider(provider);
  }

  const result = await runLiveAgent({
    prompt,
    provider,
    model,
    apiKey,
  });

  if (result.error && result.trace.events.length === 0) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    trace: result.trace,
    error: result.error ?? null,
    meta: {
      mode,
      provider,
      model,
      rate_remaining: limited.remaining,
    },
  });
}

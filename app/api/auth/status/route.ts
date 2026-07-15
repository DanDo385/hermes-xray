import { NextResponse } from "next/server";
import {
  defaultPortfolioModel,
  portfolioApiKey,
} from "@/lib/agent-runner";
import { INFERENCE_PROVIDERS } from "@/lib/auth-settings";

export const runtime = "nodejs";

export async function GET() {
  const configured = Boolean(portfolioApiKey());
  return NextResponse.json({
    portfolioGemini: configured,
    portfolioModel: defaultPortfolioModel(),
    oauth: {
      chatgpt: false,
      supergrok: false,
      reason:
        "ChatGPT and SuperGrok account OAuth do not grant third-party API inference. Use a visitor API key (Gemini / OpenAI / Anthropic / xAI / OpenRouter / Hugging Face) or the portfolio Gemini free tier.",
    },
    byokProviders: [...INFERENCE_PROVIDERS],
  });
}

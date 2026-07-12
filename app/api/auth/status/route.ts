import { NextResponse } from "next/server";
import {
  defaultPortfolioModel,
  portfolioApiKey,
} from "@/lib/agent-runner";

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
        "ChatGPT and SuperGrok account OAuth do not grant third-party API inference. Use API keys (OpenAI / xAI / Google) or the portfolio Gemini free tier.",
    },
    byokProviders: ["google", "openai", "xai"],
  });
}

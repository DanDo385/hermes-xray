import type { Metadata } from "next";
import Link from "next/link";
import { SiteChrome } from "@/components/SiteChrome";
import { getAgentManifest } from "@/lib/agent";

export const metadata: Metadata = {
  title: "Agent Mode | hermes-xray",
  description:
    "Structured, low-noise context for AI agents: /agent/, /agent.json, and /llms.txt.",
  alternates: { canonical: "/agent/" },
};

export default function AgentPage() {
  const manifest = getAgentManifest();
  const prettyManifest = JSON.stringify(manifest, null, 2);

  return (
    <main className="agent-page">
      <header className="agent-topbar">
        <Link href="/" className="agent-brand">
          hermes-xray
        </Link>
        <SiteChrome />
      </header>

      <div className="agent-inner">
        <header className="agent-hero">
          <p className="agent-kicker">Agent Mode</p>
          <h1>Human pages for humans. Structured context for agents.</h1>
          <p>
            Agent Mode exposes canonical, low-noise context so AI systems do not
            have to infer meaning from decorative HTML. This app ships a page, a
            JSON manifest, and an LLM router.
          </p>
          <div className="agent-actions">
            <a href="/agent.json" className="agent-action">
              agent.json
            </a>
            <a href="/llms.txt" className="agent-action">
              llms.txt
            </a>
            <Link href="/" className="agent-action muted">
              Open debugger
            </Link>
          </div>
        </header>

        <section className="agent-grid" aria-label="Agent Mode endpoints">
          <article className="agent-card">
            <span className="agent-card-label">01</span>
            <h2>/agent/</h2>
            <p>
              Human-readable explanation of the contract: what hermes-xray is and
              which surfaces agents should read first.
            </p>
          </article>
          <article className="agent-card">
            <span className="agent-card-label">02</span>
            <h2>/agent.json</h2>
            <p>
              Structured context: site identity, navigation, topics, and
              preferred entry points in one stable JSON surface.
            </p>
          </article>
          <article className="agent-card">
            <span className="agent-card-label">03</span>
            <h2>/llms.txt</h2>
            <p>
              A compact router for language models before they fall into layout
              noise and ornamental copy.
            </p>
          </article>
        </section>

        <section className="agent-section">
          <div className="section-label">Canonical Context</div>
          <div className="agent-context">
            <div>
              <h2>What this lab wants agents to know</h2>
              <p>{manifest.site.description}</p>
              <ul>
                {manifest.canonicalTopics.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
            </div>
            <div className="agent-principles">
              <h3>Use guidelines</h3>
              <ul>
                {manifest.agentMode.principles.map((principle) => (
                  <li key={principle}>{principle}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="agent-section">
          <div className="section-label">Manifest Preview</div>
          <pre className="agent-manifest">
            <code>{prettyManifest}</code>
          </pre>
        </section>
      </div>
    </main>
  );
}

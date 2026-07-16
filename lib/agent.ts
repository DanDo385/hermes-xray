import fs from "fs";
import path from "path";

const SITE = {
  name: "hermes-xray",
  url: "https://hermes-xray.vercel.app",
  description:
    "Debugger-style end-to-end trace of a prompt through a Hermes-style agent runtime.",
};

const PRINCIPLES = [
  "Canonical product context lives on this site's Agent Mode surfaces.",
  "Agent-facing context should be structured, stable, citation-aware, and low-noise.",
  "Prefer /agent.json and /llms.txt over scraping decorative UI HTML.",
  "Do not invent private keys, secrets, or unpublished drafts.",
];

export function getAgentManifest() {
  return {
    schema: `${SITE.url}/agent.json`,
    schemaVersion: "0.1",
    site: {
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
      owner: {
        name: "Daniel Magro",
        email: "dan@magro.dev",
        role: "Builder",
      },
    },
    agentMode: {
      purpose:
        "Expose canonical, structured context for AI agents so they do not have to infer meaning from decorative HTML.",
      endpoints: {
        overview: `${SITE.url}/agent/`,
        manifest: `${SITE.url}/agent.json`,
        router: `${SITE.url}/llms.txt`,
      },
      preferredEntryPoints: [
        `${SITE.url}/agent/`,
        `${SITE.url}/agent.json`,
        `${SITE.url}/llms.txt`,
        `${SITE.url}/`,
        `${SITE.url}/funmode`,
        "https://github.com/DanDo385/hermes-xray",
      ],
      principles: PRINCIPLES,
    },
    navigation: [
      { id: "debugger", label: "Debugger", href: `${SITE.url}/` },
      { id: "funmode", label: "Fun mode", href: `${SITE.url}/funmode` },
      { id: "agent", label: "Agent Mode", href: `${SITE.url}/agent/` },
    ],
    canonicalTopics: [
      "Hermes agent runtime",
      "tool-using agents",
      "prompt observability",
      "loop stages",
      "token estimates",
      "verification and persistence",
    ],
  };
}

export function getLlmsTxt(): string {
  const fromFile = path.join(process.cwd(), "llms.txt");
  if (fs.existsSync(fromFile)) {
    return fs.readFileSync(fromFile, "utf8");
  }
  const m = getAgentManifest();
  return [
    `# ${SITE.name}`,
    "",
    SITE.description,
    "",
    "## Agent Mode",
    "",
    `- [Agent overview](${m.agentMode.endpoints.overview})`,
    `- [JSON manifest](${m.agentMode.endpoints.manifest})`,
    `- [LLM router](${m.agentMode.endpoints.router})`,
    "",
  ].join("\n");
}

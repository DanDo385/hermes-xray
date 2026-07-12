# hermes-xray

hermes-xray is a standalone, browser-only observability demo for a Hermes-style tool-using agent.

Type a simple prompt and inspect the observable runtime path:

1. Prompt intake
2. Context construction
3. Loop policy
4. Tool dispatch
5. Verification and persistence

The interface shows model-visible prompt context, operational rationale summaries, tool events, token estimates, stop reasons, and verification evidence. It deliberately does not claim to expose hidden chain-of-thought, secrets, credentials, or private session fragments.

## Relationship to Agent Runtime

This is a separate project inspired by [Agent Runtime](https://github.com/DanDo385/agent-runtime), especially its static HTML/CSS presentation and five-part runtime model. hermes-xray does not replace Agent Runtime and has independent source, history, GitHub repository, portfolio slug, and assets.

## Run locally

No build step or dependencies are required.

```bash
python3 -m http.server 8088
```

Open `http://127.0.0.1:8088`.

## Files

```text
hermes-xray/
├── index.html          # Complete browser experience: HTML, CSS, and JavaScript
├── hermes-xray.json    # Machine-readable runtime/observability map
├── llms.txt            # Agent-readable project summary
├── PORTFOLIO.md        # Safe portfolio-site integration recipe
└── README.md
```

## Portfolio architecture

hermes-xray uses its own slug and never overwrites Agent Runtime:

```text
portfolio-site/
├── app/demos/hermes-xray/page.tsx
├── components/HermesXrayInteractive.tsx
├── content/projects/hermes-xray.json
└── public/project-assets/hermes-xray/demo/
    ├── index.html
    ├── hermes-xray.json
    └── llms.txt
```

The portfolio can iframe `/project-assets/hermes-xray/demo/index.html` from `/demos/hermes-xray`. See `PORTFOLIO.md`.

## Observability boundary

Expose:
- exact user input
- model-visible prompt/context summaries with redaction
- loop stages and stop reasons
- tool names, arguments, results, and verification
- provider token/latency metrics when available

Do not expose:
- hidden chain-of-thought
- secrets or credentials
- private memory/session fragments
- fabricated token precision or fake live model output

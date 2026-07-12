# hermes-xray

Debugger-style end-to-end trace of a prompt through [Hermes Agent](https://github.com/NousResearch/hermes-agent) — like pressing F5 through a debugger, one stage at a time.

## What you get

- **Controls:** Next event (F11), Skip detail (F10), Play all (F5), Reset
- **Panes:** call stack, locals/watches, timeline/event stream, source/stage detail
- **Pipeline strip:** inbound → hydrate → model → resolve → execute → persist → loop
- **Analyze your own prompt:** offline demo, Site Gemini (portfolio free-tier key), or bring-your-own API key

## Run locally

```bash
cp .env.example .env.local
# optional: set GEMINI_API_KEY for Site Gemini live tests
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

```bash
npm run build && npm start
```

## Inference notes

- Offline demo never calls a model (top bar shows `scripted-demo`)
- **Site Gemini** uses server `GEMINI_API_KEY` + `GEMINI_MODEL` (default `gemini-2.0-flash-lite`)
- **Your API key** supports Google / OpenAI / xAI; keys stay in the browser
- ChatGPT / SuperGrok account OAuth cannot grant third-party API inference

## Project layout

```text
app/                 # Next.js App Router + /api/run
components/          # Debugger + API key panel
lib/                 # events, stepper, demo trace, live agent runner
legacy/index.html    # prior static explainer
```

See `PORTFOLIO.md` for portfolio embed notes.

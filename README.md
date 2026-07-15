# hermes-xray

Debugger-style end-to-end trace of a prompt through [Hermes Agent](https://github.com/NousResearch/hermes-agent) - like pressing F5 through a debugger, one stage at a time.

## What you get

- **Controls:** Next event (F11), Skip detail (F10), Play all (F5), Reset
- **Panes:** call stack, locals/watches, timeline/event stream, source/stage detail
- **Pipeline strip:** inbound → hydrate → model → resolve → execute → persist → loop
- **Analyze your own prompt:** offline demo, Site Gemini (portfolio free-tier key), or bring-your-own API key
- **Fun mode** (`/funmode`): plain-English story timeline with looping turn boxes ending in the final response
- **API key safety:** warnings + basic paste checks on both Debugger and Fun mode

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

- **This site's Gemini** (recommended): visitors run live demos on the host `GEMINI_API_KEY`. The key stays on the server and is never shown in the browser.
- **Offline demo**: canned trace, no API
- **Visitor's own API key**: optional/advanced only
- ChatGPT / SuperGrok account OAuth cannot grant third-party API inference

## Project layout

```text
app/                 # Next.js App Router + /api/run
components/          # Debugger + API key panel
lib/                 # events, stepper, demo trace, live agent runner
legacy/index.html    # prior static explainer
```

See `PORTFOLIO.md` for portfolio embed notes.

# Portfolio integration

hermes-xray must remain separate from Agent Runtime.

## Asset mapping

Copy these files without renaming the Agent Runtime assets:

```text
hermes-xray/index.html       -> portfolio-site/public/project-assets/hermes-xray/demo/index.html
hermes-xray/llms.txt         -> portfolio-site/public/project-assets/hermes-xray/demo/llms.txt
hermes-xray/hermes-xray.json -> portfolio-site/public/project-assets/hermes-xray/demo/hermes-xray.json
```

Create independent portfolio surfaces:

```text
app/demos/hermes-xray/page.tsx
components/HermesXrayInteractive.tsx
content/projects/hermes-xray.json
```

Use:

```text
project slug: hermes-xray
demo route: /demos/hermes-xray
asset iframe: /project-assets/hermes-xray/demo/index.html
GitHub: https://github.com/DanDo385/hermes-xray
```

Do not edit or reuse:

```text
content/projects/agent-runtime.json
app/demos/agent-runtime/
components/AgentRuntimeInteractive.tsx
public/project-assets/agent-runtime/
```

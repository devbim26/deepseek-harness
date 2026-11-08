# Agent Note: the devBIM profile attaches the drawing5 MCP server

Status: implemented

English | [中文](2026-11-05-devbim-drawing5-mcp-bridge.zh.md)

## Problem

The devBIM deployment of the harness (`dsh web` behind the Cloudflare tunnel at `devbim.dev-bim.com`, gated by the shared-password page) could not reach the drawing set that the `drawing5` server holds: one PDF complex of the АР stage, 100 sheets, extracted into `entities.jsonl`. The server exposed that data only over HTTP endpoints (`/ask`, `/sheet`, `/stamps`) written for an external chat bot, so the agent behind the devBIM chat had no way to answer a question about the drawings. The public tunnel and password gate note (`.agents/notes/implemented/architecture/2026-11-05-devbim-public-tunnel-and-password-gate.md`) gave the surface a stable public entry, but no data source.

## Decision

The devBIM profile attaches the drawing5 MCP server through the existing `@deepseek-ai/dsh-mcp-client` bridge. The deployment overlay `packages/bundle/web-app/devbim.patch.yml` carries one row inside its `insert:` block:

```yaml
- id: mcp-drawing5
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: drawing5
    transport: streamable-http
    url: http://127.0.0.1:8808/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.DRAWING5_KEY}`'
```

The bundle's `package.json` gains `@deepseek-ai/dsh-mcp-client` as a workspace dependency, so the row's package resolves from that layer's own dependencies. The bearer key reaches the process through the launcher: `dsh-web.cmd` and `start-dsh-web-detached.ps1` load every `KEY=VALUE` line of the repo-root `.env`, and the overlay reads `DRAWING5_KEY` from there through the documented `!!js` seam, so no credential is committed.

The overlay's `insert:` block is the only place a new row can go: a top-level `- id:` row targets an existing base entry, and the loader drops it with `patch: entry "mcp-drawing5" not found` when the id is new. The tools reach the model as `mcp__drawing5__list_sheets`, `mcp__drawing5__search`, `mcp__drawing5__get_sheet`, `mcp__drawing5__get_health`, `mcp__drawing5__extract_stamps`.

The drawing5 side needs `DRAWING5_PDF` in its own `.env`: without it `get_sheet(include="raw")` answers `422`, and the agent reads only the entity layer, where the dimensions of an element are not always present. `start-drawing5-server.bat` reads the variable from `.env` for the HTTP server; `mcp_server.py` loads `.env` itself.

The MCP server listens on the loopback address only. The public `https://drawing5.dev-bim.com/mcp` route exists in the drawing5 tunnel ingress and works, but the profile points at the loopback address, because both processes run on the same host.

## Verification

`dsh --profile web --dump-config --patch packages/bundle/web-app/devbim.patch.yml` shows the row inside the composed tree. After a restart of `dsh web`, the process holds an established connection to `127.0.0.1:8808`, and the tools answer: `list_sheets` returns 100 sheets, `search` returns matching entities with their `sheet_no`, `get_sheet(include="raw")` returns the raw text layer (sheet 80 — 450 words).

In the devBIM chat at `https://devbim.dev-bim.com/` a question about the irrigation hatches produced 20 tool calls (`get_health`, `list_sheets`, several `search`, `get_sheet`) and an answer citing sheet numbers, marks `ПЛК-1` and `ПЛК-2`, sizes `250х250 мм` and `300(h)х300 мм`, and elevations `−1,000` and `−0,770` — each quoted from the text layer of the cited sheet.

## Alternatives considered

**A native `@deepseek-ai/dsh-tool-drawing5` package in the harness repository.** Rejected for this deployment: it would own the tool presentation, the session-log entries, and the permission rules of a capability that is one deployment's data source, and it would add a package, a README pair, tests, and coverage to the published surface. The MCP bridge already exists for exactly this shape — an external tool server — and the deployment needs the tools, not a new first-party capability.

**The stdio transport with the MCP server spawned by the bridge.** Rejected: the drawing5 MCP server is already a long-running service that the tunnel reaches, and the operator starts it from its own launcher. Spawning it per harness start would tie its lifetime to the harness and hide the process that holds the drawing index.

**The public `https://drawing5.dev-bim.com/mcp` URL as the profile's endpoint.** Deferred: it works, but it sends every tool call through the public edge for a peer that runs on the same host. The public route stays available for clients outside the machine.

**A row in the profile's own `cordis.patch.yml` instead of the deployment overlay.** Rejected: the devBIM overlay already owns this deployment's brand, password gate, and trust fence; the drawing bridge belongs to the same layer, and a second file would split one deployment's wiring across two places.

## Consequences

The devBIM deployment now depends on the drawing5 MCP server being up: when it is down, the bridge reconnects with its own backoff and the tools fail until it returns, while the rest of the chat keeps working. The bearer key exists in two gitignored `.env` files — the harness root for the profile, the drawing5 root for the server — and each side reads only its own. The profile's tool set grows by five model-visible tools in every session, which adds their definitions to every model request.

The bridge registers into the global tools layer, and every session of the deployment sees the drawing tools regardless of the agent preset: the preset chooses which own tools it mounts, but a deployment-level provider is visible to all agents.

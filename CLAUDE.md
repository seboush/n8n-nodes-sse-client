# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

n8n community **action node** (not a trigger) that connects to any Server-Sent Events endpoint mid-workflow. It opens an SSE stream with auth/custom headers, collects events, and returns them when a configurable stop condition is met.

## Build & Dev Commands

```bash
npm run build        # tsc + gulp build:icons (copies SVGs + codex JSON to dist/)
npm run dev          # tsc --watch
npx tsc --noEmit     # type-check without emitting
```

No test suite yet. Manual testing against SSE endpoints (e.g. https://sse.dev/test).

## Publishing

```bash
npm run build
npm publish --access public    # requires npm 2FA (OTP or granular token with bypass)
```

Published as `n8n-nodes-sse-client` on npm. The `n8n-community-node-package` keyword makes it discoverable in n8n's Community Nodes UI.

## Install in n8n (local dev)

```bash
npm run build && npm link
cd ~/.n8n/custom && npm link n8n-nodes-sse-client
# restart n8n
```

## Architecture

Single-node package — one action node in `nodes/SseClient/SseClient.node.ts`:

- **`SseClient` class** implements `INodeType` with `execute()` (not `trigger()`)
- **`processItem()`** — handles one input item: resolves URL/headers, opens `fetch()` stream, parses SSE protocol line-by-line, checks stop conditions (regex on event type / data), returns collected events
- **`buildOutputItem()`** — converts raw SSE data to n8n output item, parsing JSON when possible, attaching `$metadata`

The node uses native `fetch` + `ReadableStream` (Node 18+) — zero runtime dependencies. `n8n-workflow` is a peer dependency provided by n8n at runtime.

## Key Design Decisions

- **Credential types** — reuses n8n's built-in `httpBearerAuth`, `httpHeaderAuth`, and `anthropicApi`, shown conditionally based on the Authentication dropdown.
- **`usableAsTool: true`** — the node can be used as an AI agent tool in n8n.
- **Stop conditions are regex** — `stopEventType` matches against the SSE `event:` field, `stopDataPattern` matches against the `data:` field. Empty = no stop on that field.
- **Filter Event Types** — optional regex in Options to collect only events whose type matches. Stop conditions are still evaluated on all events regardless of filter.
- **Timeout returns partial results** — if events were collected before timeout, they're returned (not an error). Error only if zero events collected.
- **Retry wraps the entire connection** — on network error, the whole fetch+stream loop retries (not individual reads). 4xx errors skip retry (client errors won't resolve by retrying).
- Uses `NodeConnectionTypes.Main` (not `NodeConnectionType`) — the enum value export name in the installed n8n-workflow version.

## n8n Node Conventions

- Node class name must match filename: `SseClient` in `SseClient.node.ts`
- The `name` field in description (`sseClient`) is the internal identifier — must be camelCase
- `package.json` → `n8n.nodes` array points to the compiled JS in `dist/`
- Codex metadata in `SseClient.node.json` controls search/categorization in the n8n UI
- SVG icon referenced via `icon: 'file:sse-client.svg'` — must be copied to dist (gulp task)

# n8n-nodes-sse-client

SSE Client **action node** for [n8n](https://n8n.io) — connects to any Server-Sent Events endpoint mid-workflow with authentication, custom headers, and configurable stop conditions.

Unlike the built-in SSE Trigger, this node runs **inside** a workflow: it opens an SSE stream, collects events, and returns them as output items when a stop condition is met.

## Features

- Connect to any SSE endpoint as a mid-workflow action node
- **Authentication**: None, Anthropic API Key, Bearer Auth, Header Auth (API Key)
- **Custom headers** via key-value pairs or raw JSON
- **Stop conditions**: regex on event type and/or event data
- **Filter Event Types**: regex to collect only matching event types
- **Timeout with partial results**: returns collected events even on timeout
- **Retry logic** with configurable attempts and delay
- **GET and POST** HTTP methods
- **AI Agent compatible** (`usableAsTool`)
- Zero runtime dependencies (native `fetch` + `ReadableStream`)

## Installation

In your n8n instance:

1. Go to **Settings → Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-sse-client`
4. Click **Install**

Requires n8n 1.0+ and Node.js 18.10+.

## Authentication

| Method | Use case |
|---|---|
| **None** | Public SSE endpoints |
| **Anthropic API Key** | Anthropic/Claude API (sets `x-api-key` header automatically) |
| **Bearer Auth** | Endpoints expecting `Authorization: Bearer <token>` |
| **Header Auth (API Key)** | Endpoints expecting a custom header (e.g., `x-api-key`, `Authorization`) |

For Anthropic, select **Anthropic API Key** and use your existing Anthropic credential in n8n. For other API key authentication, create a **Header Auth** credential with the header name (e.g., `x-api-key`) and your API key as the value.

## Parameters

| Parameter | Description | Default |
|---|---|---|
| **URL** | SSE endpoint URL (supports expressions) | — |
| **Authentication** | Auth method | None |
| **Send Custom Headers** | Add extra headers | false |
| **Stop Event Type** | Regex on the SSE `event:` field — stops when matched | — |
| **Stop Data Pattern** | Regex on the SSE `data:` field — stops when matched | — |
| **Include Stop Event** | Include the triggering event in output | true |

### Options

| Option | Description | Default |
|---|---|---|
| **Timeout (ms)** | Global timeout | 300000 (5 min) |
| **Retry Attempts** | Number of retries on network error | 3 |
| **Retry Delay (ms)** | Delay between retries | 1000 |
| **Include Metadata** | Add `$metadata` (eventType, lastEventId, timestamp, origin) | true |
| **Max Events** | Stop after N events (0 = unlimited) | 0 |
| **Filter Event Types** | Regex — only collect events whose type matches | — |
| **HTTP Method** | GET or POST | GET |
| **Request Body** | JSON body for POST requests | — |

## Output

Each SSE event becomes one output item. If the `data:` field is valid JSON, it is parsed into the item fields. Otherwise, the raw string is returned as `{ data: "..." }`.

With **Include Metadata** enabled, each item includes:

```json
{
  "$metadata": {
    "eventType": "message",
    "lastEventId": "42",
    "timestamp": "2026-04-30T12:00:00.000Z",
    "origin": "https://example.com/sse"
  }
}
```

## Examples

### Public SSE endpoint

- **URL**: `https://sse.dev/test`
- **Authentication**: None
- **Max Events**: 5

### API with key authentication

- **URL**: `https://api.example.com/v1/events/stream`
- **Authentication**: Header Auth (API Key)
- **Credential**: Header name `x-api-key`, value = your API key
- **Stop Data Pattern**: `"status":"completed"`

### POST request with body

- **URL**: `https://api.example.com/v1/stream`
- **HTTP Method**: POST
- **Request Body**: `{"prompt": "Hello"}`
- **Stop Event Type**: `done`

## Migrating from v0.1.0

v0.2.0 temporarily removed the Anthropic API Key option. It was re-added in v0.3.0, so no migration is needed — your existing Anthropic credentials will work as before.

## License

[MIT](LICENSE)

# kagami

Claude Code plugin that collects usage analytics per session — tool usage, token consumption, and estimated cost.

## What it does

On every session stop, kagami parses the session transcript (JSONL) and sends a summary to your kagami API server.

**Collected data:**

| Data              | Description                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Tool usage        | Each tool call with category (`builtin` / `skill` / `subagent` / `mcp`), name, and model |
| Token consumption | Input / output / cache-creation / cache-read tokens, grouped by model                    |
| Estimated cost    | USD cost estimate based on Anthropic's published pricing                                 |
| Session metadata  | Session ID, user ID (git email), working directory, git branch, Claude Code version      |

## Install

```bash
claude plugin install kagami@<your-marketplace>
```

Or for local development:

```bash
claude --plugin-dir /path/to/kagami-plugin
```

## Setup

Set the environment variables for the kagami API:

```bash
export KAGAMI_API_URL="https://your-kagami-server.example.com"
export KAGAMI_API_KEY="your-api-key"  # optional
```

If `KAGAMI_API_URL` is not set, the hook exits silently — no errors, no network calls.

## How it works

```
Session Stop
  → hooks/stop-hook.sh (receives hook input via stdin)
    → node dist/stop-hook.js
      → Parse transcript JSONL (streaming)
      → Categorize tool_use events
      → Aggregate token usage by model
      → Estimate cost per model
      → POST to ${KAGAMI_API_URL}/api/events
```

The hook runs in the background and exits immediately so it never blocks session shutdown (timeout: 10s).

## API payload

```jsonc
{
  "sessionId": "abc-123",
  "userId": "user@example.com",
  "cwd": "/path/to/project",
  "gitBranch": "main",
  "ccVersion": "1.0.0",
  "sessionStartedAt": "2026-03-01T00:00:00Z",
  "sessionEndedAt": "2026-03-01T01:00:00Z",
  "events": [
    {
      "category": "builtin", // builtin | skill | subagent | mcp
      "toolName": "Read",
      "toolInput": { "file_path": "..." },
      "model": "claude-sonnet-4-6",
      "inputTokens": 1000,
      "outputTokens": 500,
      "cacheCreationTokens": 0,
      "cacheReadTokens": 800,
      "timestamp": "2026-03-01T00:05:00Z",
    },
  ],
  "tokenSummary": {
    "byModel": {
      "claude-sonnet-4-6": {
        "inputTokens": 50000,
        "outputTokens": 20000,
        "cacheCreationTokens": 10000,
        "cacheReadTokens": 30000,
        "estimatedCostUsd": 0.48,
      },
    },
    "totalEstimatedCostUsd": 0.48,
  },
}
```

## Development

Requires [Bun](https://bun.sh/) for building and testing.

```bash
bun install
bun test
bun run build   # → dist/stop-hook.js
```

The built `dist/stop-hook.js` is committed to the repo so that the plugin runs with Node.js only — no Bun required at runtime.

## License

MIT

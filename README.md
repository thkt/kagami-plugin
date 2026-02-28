# kagami

Claude Code plugin that collects usage analytics per session — tool usage, token consumption, and estimated cost.

## What it does

On every session stop (and startup for missed sessions), kagami parses the session transcript (JSONL) and sends a summary to your kagami API server.

**Collected data:**

| Data              | Description                                                                         |
| ----------------- | ----------------------------------------------------------------------------------- |
| Tool usage        | Each tool call with category (`skill` / `subagent` / `mcp`), name, and model        |
| Token consumption | Input / output / cache-creation / cache-read tokens, grouped by model               |
| Estimated cost    | USD cost estimate based on Anthropic's published pricing                            |
| Session metadata  | Session ID, user ID (git email), working directory, git branch, Claude Code version |

## Install

```bash
# 1. Add marketplace
/plugin marketplace add thkt/kagami-plugin

# 2. Install plugin
claude plugin install kagami@kagami
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

### Backfill past sessions

After initial setup, you can send past session data:

```bash
node dist/backfill.js --dry-run  # preview only
node dist/backfill.js            # send to API
```

## How it works

```
Session Stop (normal exit)
  → hooks/stop-hook.sh
    → node dist/stop-hook.js
      → Parse transcript JSONL → POST to API

Session Start (next session)
  → hooks/startup-send.sh
    → node dist/startup-send.js
      → Scan ~/.claude/projects/ for recent JSONL (48h)
      → Parse & POST any missed sessions
      → Server deduplicates by sessionId
```

Both hooks run in the background and exit immediately so they never block session start/stop (timeout: 10s).

## API payload

```jsonc
{
  "sessionId": "abc-123",
  "userId": "user@example.com",
  "cwd": "/path/to/project",
  "gitBranch": "main",
  "ccVersion": "1.0.0",
  "source": "stop", // "stop" | "startup-send" | "backfill"
  "sessionStartedAt": "2026-03-01T00:00:00Z",
  "sessionEndedAt": "2026-03-01T01:00:00Z",
  "events": [
    {
      "category": "skill", // skill | subagent | mcp
      "toolName": "commit",
      "toolInput": { "skill": "commit" },
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
bun run build   # → dist/stop-hook.js, dist/startup-send.js, dist/backfill.js
```

The built `dist/*.js` files are committed to the repo so that the plugin runs with Node.js only — no Bun required at runtime.

## License

MIT

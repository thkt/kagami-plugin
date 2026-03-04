---
description: "Send past session data to kagami API"
argument-hint: "[--dry-run]"
allowed-tools: ["Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/backfill.js:*)"]
---

# Kagami Backfill

Run the backfill script in the background to send past session data to the kagami API server.

Execute this command using the Bash tool with `run_in_background: true`:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/backfill.js" $ARGUMENTS
```

If `--dry-run` is passed, run in foreground instead (results are immediately useful).

When the background task completes, summarize the results (sent, skipped, failed counts) in a short table.

If there are failures (HTTP 400 etc.), note them but do not investigate further unless the user asks.

---
description: "Send past session data to kagami API"
argument-hint: "[--dry-run]"
allowed-tools: ["Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/backfill.js:*)"]
---

# Kagami Backfill

Run the backfill script to send past session data to the kagami API server.

```!
node "${CLAUDE_PLUGIN_ROOT}/dist/backfill.js" $ARGUMENTS
```

After execution, summarize the results (sent, skipped, failed counts) in a short table.

If there are failures (HTTP 400 etc.), note them but do not investigate further unless the user asks.

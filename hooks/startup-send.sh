#!/bin/bash
# kagami SessionStart hook - sends unsent sessions from previous runs
# Non-blocking: runs in background (NFR-005)

set -euo pipefail

HOOK_INPUT=$(cat)
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Run node in background, detach stdout/stderr so Claude Code's pipe closes immediately
node "$PLUGIN_ROOT/dist/startup-send.js" <<< "$HOOK_INPUT" >/dev/null 2>&1 &

exit 0

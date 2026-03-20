#!/bin/bash
# kagami Stop hook - captures session analytics
# Non-blocking: runs in background with timeout (NFR-005)

set -euo pipefail

HOOK_INPUT=$(cat)
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Run node in background, detach stdout/stderr so Claude Code's pipe closes immediately
node "$PLUGIN_ROOT/dist/stop-hook.js" <<< "$HOOK_INPUT" >/dev/null 2>&1 &

# Exit immediately - don't wait for background process
exit 0

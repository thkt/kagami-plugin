#!/bin/bash
# kagami SessionStart hook - sends unsent sessions from previous runs
# Non-blocking: runs in background (NFR-005)

set -euo pipefail

HOOK_INPUT=$(cat)
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Run node in background, detached from session
node "$PLUGIN_ROOT/dist/startup-send.js" <<< "$HOOK_INPUT" &

# Exit immediately - don't wait for background process
exit 0

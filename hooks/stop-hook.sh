#!/bin/bash
# kagami Stop hook - captures session analytics
# Non-blocking: runs in background with timeout (NFR-005)

set -euo pipefail

HOOK_INPUT=$(cat)
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Run node in background, detached from session
# timeout 10s to ensure we don't block (hooks.json also has timeout: 10000)
node "$PLUGIN_ROOT/dist/stop-hook.js" <<< "$HOOK_INPUT" &

# Exit immediately - don't wait for background process
exit 0

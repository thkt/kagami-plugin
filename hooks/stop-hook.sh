#!/bin/bash
# kagami Stop hook - captures session analytics
# Non-blocking: runs in background with timeout (NFR-005)

set -euo pipefail

HOOK_INPUT=$(cat)
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Run bun in background, detached from session
# timeout 10s to ensure we don't block (hooks.json also has timeout: 10000)
bun run "$PLUGIN_ROOT/src/stop-hook.ts" <<< "$HOOK_INPUT" &

# Exit immediately - don't wait for background process
exit 0

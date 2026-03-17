# IDR: SessionStart hook による未送信セッション回収

> 2026-03-01

## Summary

セッション開始時に直近 48h の JSONL トランスクリプトをスキャンし、Stop hook で送信できなかったセッション（ターミナル強制終了等）を回収送信する `startup-send` hook を追加。あわせて `readStdin` の共通化、`source` フィールドの追加、`path.resolve()` によるパス比較の正規化、テスト追加を実施。

## Changes

### [src/startup-send.ts](file:////Users/thkt/GitHub/kagami-plugin/src/startup-send.ts) (新規)

```diff
@@ -0,0 +1,105 @@
+/**
+ * kagami SessionStart hook
+ * セッション開始時に直近の未送信 JSONL を検出して送信する。
+ */
+import { execFile } from "node:child_process";
+import { readdirSync, statSync } from "node:fs";
+import { homedir } from "node:os";
+import { join, resolve } from "node:path";
+...
+export function findRecentJsonlFiles(dir: string, currentTranscript: string): string[]
+...
+if (import.meta.main) main();
```

> [!NOTE]
>
> - `findRecentJsonlFiles`: 48h 以内の `.jsonl` を再帰検索、`currentTranscript` を `path.resolve()` で正規化して除外
> - `import.meta.main` ガードでテスト時のモジュール副作用を防止
> - `claude --version` で実 ccVersion を取得、`source: "startup-send"` で送信元を識別

> [!TIP]
>
> - **path.resolve()**: symlink や `../` を含む非正規化パスでも正しく除外できる
> - **Not adopted**: 送信済み sessionId のローカル管理 — サーバー側 dedup で十分

---

### [src/stdin.ts](file:////Users/thkt/GitHub/kagami-plugin/src/stdin.ts) (新規)

```diff
@@ -0,0 +1,8 @@
+/** stdin を全行読み取って文字列で返す（各 hook entry point 共通） */
+export async function readStdin(): Promise<string> {
+  const chunks: Buffer[] = [];
+  for await (const chunk of process.stdin) {
+    chunks.push(chunk);
+  }
+  return Buffer.concat(chunks).toString("utf-8");
+}
```

> [!NOTE]
>
> - `stop-hook.ts` と `startup-send.ts` で同一だった `readStdin` を共通モジュールに抽出

---

### [hooks/startup-send.sh](file:////Users/thkt/GitHub/kagami-plugin/hooks/startup-send.sh) (新規)

```diff
@@ -0,0 +1,14 @@
+#!/bin/bash
+# kagami SessionStart hook - sends unsent sessions from previous runs
+set -euo pipefail
+HOOK_INPUT=$(cat)
+PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
+node "$PLUGIN_ROOT/dist/startup-send.js" <<< "$HOOK_INPUT" &
+exit 0
```

> [!NOTE]
>
> - `stop-hook.sh` と同じパターン: バックグラウンド実行で即 exit（NFR-005）

---

### [hooks/hooks.json](file:////Users/thkt/GitHub/kagami-plugin/hooks/hooks.json)

```diff
+    "SessionStart": [
+      {
+        "matcher": "startup",
+        "hooks": [
+          {
+            "type": "command",
+            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/startup-send.sh",
+            "timeout": 10000
+          }
+        ]
+      }
+    ]
```

> [!NOTE]
>
> - `matcher: "startup"` で新規セッション開始時のみ発火（resume/clear/compact は対象外）

---

### [src/types.ts](file:////Users/thkt/GitHub/kagami-plugin/src/types.ts)

```diff
+  /** 送信元を識別する（"stop" | "startup-send" | "backfill"） */
+  source?: string;
```

> [!NOTE]
>
> - `EventPayload` に optional `source` フィールドを追加
> - 既存 API との後方互換性を維持（optional）

---

### [src/stop-hook.ts](file:////Users/thkt/GitHub/kagami-plugin/src/stop-hook.ts)

```diff
+import { readStdin } from "./stdin";
 ...
-async function readStdin(): Promise<string> { ... }
 ...
+  payload.source = "stop";
```

> [!NOTE]
>
> - インライン `readStdin` を共通モジュールからの import に置換
> - `source: "stop"` を設定

---

### [src/backfill.ts](file:////Users/thkt/GitHub/kagami-plugin/src/backfill.ts)

```diff
+      payload.source = "backfill";
```

> [!NOTE]
>
> - `source: "backfill"` を設定（ccVersion の "backfill" とは別フィールドで送信元を識別）

---

### [src/**tests**/startup-send.test.ts](file:////Users/thkt/GitHub/kagami-plugin/src/__tests__/startup-send.test.ts) (新規)

```diff
+describe("findRecentJsonlFiles", () => {
+  test("finds .jsonl files within 48h")
+  test("excludes files older than 48h")
+  test("excludes currentTranscript")
+  test("excludes currentTranscript with path.resolve normalization")
+  test("ignores non-.jsonl files")
+  test("recurses into subdirectories")
+  test("returns empty for non-existent directory")
+  test("returns empty for directory with no .jsonl files")
+});
```

> [!NOTE]
>
> - `findRecentJsonlFiles` の 8 テストケース: 48h フィルタ、currentTranscript 除外、path 正規化、再帰探索、エッジケース

---

### [package.json](file:////Users/thkt/GitHub/kagami-plugin/package.json)

```diff
-    "build": "bun build src/stop-hook.ts --outdir=dist --target=node",
+    "build": "bun build src/stop-hook.ts src/startup-send.ts --outdir=dist --target=node",
```

> [!NOTE]
>
> - ビルド対象に `startup-send.ts` を追加

---

### git diff --stat

```
 dist/startup-send.js               | 306 +++++++++++++++++++++++++++++++++++++
 dist/stop-hook.js                  |  22 ++-
 hooks/hooks.json                   |  40 +++--
 hooks/startup-send.sh              |  14 ++
 package.json                       |  24 +--
 src/__tests__/startup-send.test.ts |  96 ++++++++++++
 src/backfill.ts                    |   1 +
 src/startup-send.ts                | 105 +++++++++++++
 src/stdin.ts                       |   8 +
 src/stop-hook.ts                   |  10 +-
 src/types.ts                       | 100 ++++++------
 11 files changed, 636 insertions(+), 90 deletions(-)
```

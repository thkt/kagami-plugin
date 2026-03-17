# IDR: API POST ロジックの共通化

> 2026-03-01

## Summary

stop-hook.ts と backfill.ts に重複していた fetch POST ロジック（headers 組み立て・Authorization ヘッダー・タイムアウト制御）を新規 src/api.ts の `sendPayload()` 関数に抽出。手動 AbortController を `AbortSignal.timeout()` に置き換え、コードを簡素化した。動作変更なし。

## Changes

### [src/api.ts](file:////Users/thkt/GitHub/kagami-plugin/src/api.ts)

```diff
@@ -0,0 +1,20 @@
+import type { EventPayload } from "./types";
+
+export function sendPayload(
+  apiUrl: string,
+  apiKey: string | undefined,
+  payload: EventPayload,
+  timeoutMs?: number,
+): Promise<Response> {
+  const headers: Record<string, string> = {
+    "Content-Type": "application/json",
+  };
+  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
+
+  return fetch(`${apiUrl}/api/events`, {
+    method: "POST",
+    headers,
+    body: JSON.stringify(payload),
+    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
+  });
+}
```

> [!NOTE]
>
> - 新規ファイル: headers 組み立て・fetch POST・タイムアウトを一箇所に集約
> - `timeoutMs` はオプショナル（backfill は無制限、stop-hook は 8s）

> [!TIP]
>
> - **AbortSignal.timeout()**: 手動 AbortController + setTimeout + clearTimeout より簡潔
> - **Not adopted**: 共通モジュールではなく各ファイルにヘルパー関数 — 重複が解消されない

---

### [src/stop-hook.ts](file:////Users/thkt/GitHub/kagami-plugin/src/stop-hook.ts)

```diff
@@ -6,6 +6,7 @@
 import { execFile } from "node:child_process";
 import { promisify } from "node:util";
+import { sendPayload } from "./api";
 import { parseTranscript } from "./parser";

@@ -61,22 +62,7 @@
   // API に POST (fire-and-forget, タイムアウト 8s)
   try {
-    const controller = new AbortController();
-    const timeout = setTimeout(() => controller.abort(), 8000);
-
-    const headers: Record<string, string> = {
-      "Content-Type": "application/json",
-    };
-    if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
-
-    await fetch(`${API_URL}/api/events`, {
-      method: "POST",
-      headers,
-      body: JSON.stringify(payload),
-      signal: controller.signal,
-    });
-
-    clearTimeout(timeout);
+    await sendPayload(API_URL, API_KEY, payload, 8000);
   } catch {
```

> [!NOTE]
>
> - 15行のインライン fetch → 1行の `sendPayload()` 呼び出しに置換
> - タイムアウト 8s の挙動は維持

---

### [src/backfill.ts](file:////Users/thkt/GitHub/kagami-plugin/src/backfill.ts)

```diff
@@ -11,6 +11,7 @@
 import { readdirSync, statSync } from "node:fs";
 import { homedir } from "node:os";
 import { join } from "node:path";
+import { sendPayload } from "./api";
 import { parseTranscript } from "./parser";

@@ -91,14 +92,1 @@
-      const headers: Record<string, string> = {
-        "Content-Type": "application/json",
-      };
-      if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
-
-      const res = await fetch(`${API_URL}/api/events`, {
-        method: "POST",
-        headers,
-        body: JSON.stringify(payload),
-      });
+      const res = await sendPayload(API_URL!, API_KEY, payload);
```

> [!NOTE]
>
> - 10行のインライン fetch → 1行の `sendPayload()` 呼び出しに置換
> - インデントがタブからスペースに正規化（linter 自動修正）

---

### git diff --stat

```
 dist/stop-hook.js |  30 ++++-----
 src/api.ts        |  20 ++++++
 src/backfill.ts   | 180 ++++++++++++++++++++++++++----------------------------
 src/stop-hook.ts  |  18 +-----
 4 files changed, 123 insertions(+), 125 deletions(-)
```

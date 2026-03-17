# IDR: Backfill HTTP 400 — subagent sessionId と空 model の修正

> 2026-03-04

## Summary

kagami-backfill で 92 件が HTTP 400 になる問題を修正。Root Cause は 2 つ: (1) subagent の sessionId が `uuid:agentId` 形式で UUID バリデーションに失敗（10 件）、(2) skill イベントの model が空文字列で `min(1)` バリデーションに失敗（82 件）。両方プラグイン側 parser.ts で対応。

## Changes

### [src/parser.ts](file:////Users/thkt/GitHub/kagami-plugin/src/parser.ts)

```diff
@@ -1,3 +1,4 @@
+import { createHash } from "node:crypto";

@@ +49,18 @@
+export function deterministicUuid(namespace: string, name: string): string {
+  const hash = createHash("sha256").update(`${namespace}:${name}`).digest();
+  hash[6] = (hash[6] & 0x0f) | 0x40; // version 4
+  hash[8] = (hash[8] & 0x3f) | 0x80; // variant 10xx
+  const hex = hash.toString("hex");
+  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-...`;
+}

@@ -220,13 +233,24 @@
+  const fallbackModel = Object.keys(byModel)[0] ?? "";
+  if (fallbackModel) {
+    for (const event of events) {
+      if (!event.model) event.model = fallbackModel;
+    }
+  }
+  const validEvents = events.filter((e) => e.model);
-  const truncated = truncateEvents(events, MAX_EVENTS);
+  const truncated = truncateEvents(validEvents, MAX_EVENTS);

-  const effectiveSessionId = agentId ? `${sessionId}:${agentId}` : sessionId;
+  const effectiveSessionId = agentId ? deterministicUuid(sessionId, agentId) : sessionId;
```

> [!NOTE]
>
> - **Root Cause 1 (sessionId)**: `${sessionId}:${agentId}` → `deterministicUuid(sessionId, agentId)` で UUID v4 形式を保証
> - **Root Cause 2 (model)**: セッション内の byModel から逆引きで埋め、残った空 model イベントは除外

> [!TIP]
>
> - **deterministicUuid**: SHA-256 ハッシュに UUID v4 ビットマスクを適用。同じ入力で常に同じ UUID を生成するため、再 backfill しても sessionId が安定する
> - **Not adopted**: UUID v5（RFC 4122 SHA-1）— node:crypto の SHA-256 で十分かつシンプル。npm 依存追加も不要

---

### [src/stop-hook.ts](file:////Users/thkt/GitHub/kagami-plugin/src/stop-hook.ts)

```diff
-const API_URL = process.env.KAGAMI_API_URL;
+const API_URL = process.env.KAGAMI_API_URL ?? "";
```

> [!NOTE]
>
> - `?? ""` で型を `string | undefined` → `string` に狭める（機能的には no-op）

---

### [src/**tests**/parser.test.ts](file:////Users/thkt/GitHub/kagami-plugin/src/__tests__/parser.test.ts)

> [!NOTE]
>
> - `deterministicUuid`: format / deterministic / uniqueness / namespace 分離の 4 テスト追加
> - `parseTranscript`: model backfill 成功・失敗ケース、subagent UUID 生成の検証を追加・更新
> - 既存テスト 3 件のアサーション更新（sessionId 形式変更、null 返却条件変更に対応）

---

### dist/backfill.js, dist/startup-send.js, dist/stop-hook.js

> [!NOTE]
>
> - `bun build` による再ビルド成果物。ソース変更の反映のみ

---

### git diff --stat

```
 dist/backfill.js             | 102 +++++++++++++++++++++++++++++++++++++-----
 dist/startup-send.js         | 102 +++++++++++++++++++++++++++++++++++++-----
 dist/stop-hook.js            | 104 ++++++++++++++++++++++++++++++++++++++-----
 src/__tests__/parser.test.ts |  91 ++++++++++++++++++++++++++++++++++---
 src/parser.ts                |  30 +++++++++++--
 src/stop-hook.ts             |   2 +-
 6 files changed, 391 insertions(+), 40 deletions(-)
```

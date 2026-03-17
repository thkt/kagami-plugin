# IDR: marketplace.json 追加・README 更新・agentId セッション区別・backfill ビルド

> 2026-03-01

## Summary

プラグイン配布用の marketplace.json 追加、README をインストール手順・SessionStart hook・source フィールド等で更新、subagent セッションを agentId で区別するよう parser を修正、backfill.ts を dist ビルドに追加。

## Changes

### [.claude-plugin/marketplace.json](file:////Users/thkt/GitHub/kagami-plugin/.claude-plugin/marketplace.json) (新規)

```diff
@@ -0,0 +1,13 @@
+{
+  "name": "kagami",
+  "owner": { "name": "thkt" },
+  "plugins": [
+    {
+      "name": "kagami",
+      "source": ".",
+      "description": "Claude Code usage analytics collector"
+    }
+  ]
+}
```

> [!NOTE]
>
> - `source: "."` で同一リポジトリを指す単一プラグインマーケットプレイス
> - `/plugin marketplace add thkt/kagami-plugin` → `claude plugin install kagami@kagami` で配布可能に

---

### [README.md](file:////Users/thkt/GitHub/kagami-plugin/README.md)

> [!NOTE]
>
> - Install: marketplace add → plugin install の2ステップに修正
> - What it does: SessionStart での回収に言及、category から `builtin` を削除
> - Setup: backfill 手順を追加（`node dist/backfill.js`）
> - How it works: Stop + SessionStart の二段構えを図示
> - API payload: `source` フィールド追加、example を skill に変更
> - Development: build 成果物に3ファイル列挙

---

### [src/parser.ts](file:////Users/thkt/GitHub/kagami-plugin/src/parser.ts)

```diff
+  let agentId = "";
 ...
+    if (line.agentId && !agentId) agentId = line.agentId;
 ...
+  const effectiveSessionId = agentId ? `${sessionId}:${agentId}` : sessionId;
 ...
-    sessionId,
+    sessionId: effectiveSessionId,
```

> [!NOTE]
>
> - subagent トランスクリプトは親と同じ sessionId を持つため、`agentId` を suffix として付与して一意にする
> - 親セッション（agentId なし）は従来通りの sessionId を使用

---

### [src/types.ts](file:////Users/thkt/GitHub/kagami-plugin/src/types.ts)

```diff
+  /** subagent セッションの場合に設定される */
+  agentId?: string;
```

> [!NOTE]
>
> - `TranscriptLine` に `agentId` フィールドを追加

---

### [src/**tests**/parser.test.ts](file:////Users/thkt/GitHub/kagami-plugin/src/__tests__/parser.test.ts)

```diff
+  test("composes sessionId with agentId for subagent JSONL")
+  test("keeps original sessionId when no agentId (parent session)")
```

> [!NOTE]
>
> - agentId 付き → `sessionId:agentId` に合成されること
> - agentId なし → 元の sessionId のままであること

---

### [package.json](file:////Users/thkt/GitHub/kagami-plugin/package.json)

```diff
-    "build": "bun build src/stop-hook.ts src/startup-send.ts --outdir=dist --target=node",
+    "build": "bun build src/stop-hook.ts src/startup-send.ts src/backfill.ts --outdir=dist --target=node",
```

> [!NOTE]
>
> - backfill を dist にビルドすることで `node dist/backfill.js` で実行可能に（bun 不要）

---

### git diff --stat

```
 .claude-plugin/marketplace.json | 13 ++++++++
 README.md                       | 59 ++++++++++++++++++++++-------------
 dist/startup-send.js            |  6 +++-
 dist/stop-hook.js               |  6 +++-
 package.json                    |  2 +-
 src/__tests__/parser.test.ts    | 69 +++++++++++++++++++++++++++++++++++++++++
 src/parser.ts                   |  7 ++++-
 src/types.ts                    |  2 ++
 8 files changed, 139 insertions(+), 25 deletions(-)
```

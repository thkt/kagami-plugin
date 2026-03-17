# IDR: Bun ランタイム依存を Node.js 標準 API に移行

> 2026-03-01

## Summary

Claude Code プラグイン kagami のランタイム依存を Bun から Node.js に移行。`Bun.spawn`, `Bun.stdin`, `Bun.env` を `node:child_process`, `process.stdin`, `process.env` に置き換え、ビルド済み `dist/stop-hook.js` をリポジトリに含めることで、プラグインインストール時に Bun 不要・`node` のみで動作する構成にした。README も新規追加。

## Changes

### [src/stop-hook.ts](file:////Users/thkt/GitHub/kagami-plugin/src/stop-hook.ts)

```diff
@@ -1,12 +1,16 @@
+import { execFile } from "node:child_process";
+import { promisify } from "node:util";
 import { parseTranscript } from "./parser";
+const execFileAsync = promisify(execFile);

-const API_URL = Bun.env.KAGAMI_API_URL;
-const API_KEY = Bun.env.KAGAMI_API_KEY;
+const API_URL = process.env.KAGAMI_API_URL;
+const API_KEY = process.env.KAGAMI_API_KEY;

-  const raw = await new Response(Bun.stdin.stream()).text();
+  const raw = await readStdin();

-  const proc = Bun.spawn(["claude", "--version"], {
-    stdout: "pipe", stderr: "ignore",
-  });
-  const version = (await new Response(proc.stdout).text()).trim();
+  const { stdout } = await execFileAsync("claude", ["--version"]);
+  payload.ccVersion = stdout.trim();
```

> [!NOTE]
>
> - `Bun.env` → `process.env` に置き換え
> - `Bun.stdin.stream()` → `readStdin()` ヘルパー（`process.stdin` の async iterator）
> - `Bun.spawn` → `execFileAsync`（`node:child_process` の promisify）

> [!TIP]
>
> - **execFileAsync**: `child_process.execFile` + `promisify` で Bun.spawn と同等の非同期 API を実現。spawn より簡潔
> - **Not adopted**: `child_process.spawn` + stream 手動読み取り — stdout が短い（バージョン文字列のみ）ため execFile で十分

---

### [src/parser.ts](file:////Users/thkt/GitHub/kagami-plugin/src/parser.ts)

```diff
@@ -1,5 +1,8 @@
+import { execFile } from "node:child_process";
 import { createReadStream } from "node:fs";
 import { createInterface } from "node:readline";
+import { promisify } from "node:util";
+const execFileAsync = promisify(execFile);

-  const proc = Bun.spawn(["git", "config", "user.email"], {
-    cwd, stdout: "pipe", stderr: "ignore",
-  });
-  const text = await new Response(proc.stdout).text();
+  const { stdout } = await execFileAsync("git", ["config", "user.email"], {
+    cwd,
+  });
+  return stdout.trim() || getUserFallback();

-  return Bun.env.USER ?? Bun.env.USERNAME ?? "unknown";
+  return process.env.USER ?? process.env.USERNAME ?? "unknown";
```

> [!NOTE]
>
> - `Bun.spawn` → `execFileAsync` に置き換え（git user.email 取得）
> - `Bun.env.USER` → `process.env.USER` に置き換え

> [!TIP]
>
> - **execFileAsync**: stop-hook.ts と同じパターンで統一
> - **Not adopted**: `execa` 等の外部ライブラリ — 依存ゼロを維持するため不採用

---

### [hooks/stop-hook.sh](file:////Users/thkt/GitHub/kagami-plugin/hooks/stop-hook.sh)

```diff
@@ -10,3 +10,3 @@
-# Run bun in background, detached from session
+# Run node in background, detached from session
-bun run "$PLUGIN_ROOT/src/stop-hook.ts" <<< "$HOOK_INPUT" &
+node "$PLUGIN_ROOT/dist/stop-hook.js" <<< "$HOOK_INPUT" &
```

> [!NOTE]
>
> - ランタイムを `bun run src/stop-hook.ts` → `node dist/stop-hook.js` に変更

> [!TIP]
>
> - **ビルド済み JS を実行**: TypeScript の直接実行（bun/tsx）を避け、事前バンドルした JS を node で実行。プラグイン利用者に追加ツール不要
> - **Not adopted**: `tsx` や `ts-node` で TS 直接実行 — ランタイム依存が増えるため不採用

---

### [.gitignore](file:////Users/thkt/GitHub/kagami-plugin/.gitignore)

```diff
@@ -1,4 +1,3 @@
 node_modules/
-dist/
 *.log
 .DS_Store
```

> [!NOTE]
>
> - `dist/` をバージョン管理対象に変更（ビルド済みバンドルをリポジトリに含める）

> [!TIP]
>
> - **dist/ を追跡**: プラグインインストール時に build ステップ不要にするための判断
> - **Not adopted**: postinstall や SessionStart hook で自動ビルド — bun 依存が残り、インストール環境の前提が増える

---

### [dist/stop-hook.js](file:////Users/thkt/GitHub/kagami-plugin/dist/stop-hook.js)

> [!NOTE]
>
> - `bun build src/stop-hook.ts --outdir=dist --target=node` で生成（7.0 KB）
> - parser.ts, cost.ts, types.ts を単一ファイルにバンドル
> - 外部依存ゼロ（node 標準モジュールのみ）

---

### [README.md](file:////Users/thkt/GitHub/kagami-plugin/README.md)

> [!NOTE]
>
> - プラグイン概要、インストール方法、環境変数設定、処理フロー、API ペイロード構造、開発手順を記載

---

### git diff --stat

```
 .gitignore         |   1 -
 README.md          | 109 +++++++++++++++++
 dist/stop-hook.js  | 239 ++++++++++++++++++++++++++++++++++++
 hooks/stop-hook.sh |   4 +-
 src/parser.ts      | 354 ++++++++++++++++++++++++++---------------------------
 src/stop-hook.ts   | 112 +++++++++--------
 6 files changed, 584 insertions(+), 235 deletions(-)
```

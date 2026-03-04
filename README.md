# kagami

Claude Code のセッションごとに利用状況（ツール利用・トークン消費・推定コスト）を自動収集するプラグイン。

## 収集データ

セッション終了時（および次回起動時の未送信分リカバリ）に、トランスクリプト（JSONL）を解析して kagami API サーバーへ送信します。

| データ         | 内容                                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| ツール利用     | skill / subagent / mcp / builtin の各ツール呼び出し（名前・モデル、上限 500 件）   |
| トークン消費   | input / output / cache-creation / cache-read トークン数（モデル別）                |
| 推定コスト     | Anthropic 公式料金ベースの USD コスト                                              |
| セッション情報 | セッション ID、ユーザー ID（git email）、作業ディレクトリ、ブランチ、CC バージョン |

## セットアップ

### 1. 環境変数の設定

Claude Code の `settings.json` に追加（推奨）:

```json
{
  "env": {
    "KAGAMI_API_URL": "https://your-kagami-server.example.com",
    "KAGAMI_API_KEY": "your-api-key"
  }
}
```

または `.bashrc` / `.zshrc` 等に追加:

```bash
export KAGAMI_API_URL="https://your-kagami-server.example.com"
export KAGAMI_API_KEY="your-api-key"
```

`KAGAMI_API_URL` が未設定の場合、hook は何もせず終了します（エラーもネットワーク通信も発生しません）。

### 2. プラグインのインストール

```bash
# marketplace 追加
/plugin marketplace add thkt/kagami-plugin

# プラグインインストール
claude plugin install kagami@kagami
```

### 3. 過去セッションの送信（任意）

セットアップ前のセッションデータを一括送信できます。プラグインのインストール先パスは環境依存のため、リポジトリから直接実行するのが確実です。

```bash
npx -y degit thkt/kagami-plugin /tmp/kagami-plugin
node /tmp/kagami-plugin/dist/backfill.js --dry-run  # プレビュー
node /tmp/kagami-plugin/dist/backfill.js            # 送信
```

外部依存なし（Node.js のみで実行可能）。

## 仕組み

```
セッション終了（通常終了）
  → hooks/stop-hook.sh
    → node dist/stop-hook.js
      → トランスクリプト JSONL を解析 → API へ POST

セッション開始（次回起動時）
  → hooks/startup-send.sh
    → node dist/startup-send.js
      → ~/.claude/projects/ 配下の直近 48 時間の JSONL をスキャン
      → 未送信セッションを解析 & POST
      → サーバー側で sessionId による重複排除
```

どちらもバックグラウンド実行（10 秒タイムアウト）のため、セッションの開始・終了をブロックしません。

## API ペイロード

```jsonc
{
  "sessionId": "abc-123",
  "userId": "user@example.com",
  "cwd": "/path/to/project",
  "gitBranch": "main",
  "ccVersion": "1.0.0",
  "source": "stop", // "stop" | "startup-send" | "backfill"
  "sessionStartedAt": "2026-03-01T00:00:00Z",
  "sessionEndedAt": "2026-03-01T01:00:00Z",
  "events": [
    {
      "category": "skill", // skill | subagent | mcp | builtin
      "toolName": "commit", // Bash の場合は CLI ツール名 (git, scout 等)
      "toolInput": { "skill": "commit" }, // builtin は null
      "model": "claude-sonnet-4-6",
      "inputTokens": 1000, // 同一メッセージ内の tool_use 数で按分
      "outputTokens": 500,
      "cacheCreationTokens": 0,
      "cacheReadTokens": 800,
      "timestamp": "2026-03-01T00:05:00Z",
    },
  ],
  "tokenSummary": {
    "byModel": {
      "claude-sonnet-4-6": {
        "inputTokens": 50000,
        "outputTokens": 20000,
        "cacheCreationTokens": 10000,
        "cacheReadTokens": 30000,
        "estimatedCostUsd": 0.48,
      },
    },
    "totalEstimatedCostUsd": 0.48,
  },
}
```

## 開発

ビルド・テストには [Bun](https://bun.sh/) が必要です。

```bash
bun install
bun test
bun run build   # → dist/stop-hook.js, dist/startup-send.js, dist/backfill.js
```

ローカルでプラグインの動作確認をする場合:

```bash
claude --plugin-dir /path/to/kagami-plugin
```

ビルド済みの `dist/*.js` はリポジトリにコミットされているため、ランタイムでは Node.js のみで動作します（Bun 不要）。

## License

MIT

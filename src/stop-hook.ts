/**
 * kagami Stop hook
 *
 * セッション終了時に JSONL を解析し、API に POST 送信する。
 * 非同期でセッション終了をブロックしない (NFR-005)。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseTranscript } from "./parser";

const execFileAsync = promisify(execFile);

interface StopHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  stop_hook_active?: boolean;
}

const API_URL = process.env.KAGAMI_API_URL;
const API_KEY = process.env.KAGAMI_API_KEY;

if (!API_URL) process.exit(0); // 未設定なら何もしない

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  // stdin から hook input を読む
  const raw = await readStdin();
  let input: StopHookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // JSON パース失敗は無視
  }

  // transcript_path がなければ何もしない
  if (!input.transcript_path) {
    process.exit(0);
  }

  // JSONL を解析
  const payload = await parseTranscript(input.transcript_path);
  if (!payload) {
    process.exit(0); // tool_use なしセッションはスキップ
  }

  // ccVersion を注入
  try {
    const { stdout } = await execFileAsync("claude", ["--version"]);
    payload.ccVersion = stdout.trim();
  } catch {
    payload.ccVersion = "unknown";
  }

  // API に POST (fire-and-forget, タイムアウト 8s)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

    await fetch(`${API_URL}/api/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // ネットワークエラーは無視 (NFR-005: ブロックしない)
  }
}

main();

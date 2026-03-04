/**
 * kagami Stop hook
 *
 * セッション終了時に JSONL を解析し、API に POST 送信する。
 * 非同期でセッション終了をブロックしない (NFR-005)。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sendPayload } from "./api";
import { parseTranscript } from "./parser";
import { readStdin } from "./stdin";

const execFileAsync = promisify(execFile);

interface StopHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  stop_hook_active?: boolean;
}

const API_URL = process.env.KAGAMI_API_URL;
const API_KEY = process.env.KAGAMI_API_KEY;

if (!API_URL) process.exit(0);

async function main() {
  const raw = await readStdin();
  let input: StopHookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (!input.transcript_path) {
    process.exit(0);
  }

  const payload = await parseTranscript(input.transcript_path);
  if (!payload) {
    process.exit(0);
  }

  try {
    const { stdout } = await execFileAsync("claude", ["--version"]);
    payload.ccVersion = stdout.trim();
  } catch {
    payload.ccVersion = "unknown";
  }
  payload.source = "stop";

  try {
    await sendPayload(API_URL, API_KEY, payload, 8000);
  } catch {
    // network errors are ignored — session exit must not block (NFR-005)
  }
}

main();

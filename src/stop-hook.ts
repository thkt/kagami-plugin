/**
 * kagami Stop hook
 *
 * セッション終了時に JSONL を解析し、API に POST 送信する。
 * 非同期でセッション終了をブロックしない (NFR-005)。
 */
import { sendPayload } from "./api";
import { parseTranscript } from "./parser";
import { appendSentId } from "./sent";
import { parseStdinJson, resolveCcVersion } from "./shared";
import { SIGNING_KEY_DIR } from "./signing";

interface StopHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  stop_hook_active?: boolean;
}

async function main() {
  const API_URL = process.env.KAGAMI_API_URL ?? "";
  const API_KEY = process.env.KAGAMI_API_KEY;
  if (!API_URL) process.exit(0);

  let input: StopHookInput;
  try {
    input = await parseStdinJson<StopHookInput>();
  } catch {
    process.exit(0);
  }

  if (!input.transcript_path) {
    process.exit(0);
  }

  let payload;
  try {
    payload = await parseTranscript(input.transcript_path);
  } catch {
    // parseTranscript failure must not block session exit (NFR-005)
    process.exit(0);
  }

  if (!payload) {
    await appendSentId(input.session_id);
    process.exit(0);
  }

  payload.ccVersion = await resolveCcVersion();
  payload.source = "stop";

  try {
    const res = await sendPayload({
      apiUrl: API_URL,
      apiKey: API_KEY,
      payload,
      timeoutMs: 8000,
      signingKeyDir: SIGNING_KEY_DIR,
    });
    if (res.ok) await appendSentId(input.session_id);
  } catch {
    // network errors are ignored — session exit must not block (NFR-005)
  }
}

if (import.meta.main) main();

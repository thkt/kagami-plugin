/**
 * kagami SessionStart hook
 *
 * セッション開始時に直近の未送信 JSONL を検出して送信する。
 * Stop hook で送れなかったセッション（ターミナル閉じ等）の回収が目的。
 * サーバー側で sessionId の重複排除を行う前提。
 */
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sendPayload } from "./api";
import { parseTranscript } from "./parser";
import { appendSentId, loadSentIds, sessionIdFromPath } from "./sent";
import { parseStdinJson, resolveCcVersion } from "./shared";
import { SIGNING_KEY_DIR } from "./signing";

const STARTUP_DELAY_MS = 30_000;

interface SessionStartInput {
  session_id: string;
  transcript_path?: string;
}

const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h

/** 直近 MAX_AGE_MS 以内の JSONL ファイルを再帰検索する（currentTranscript は除外） */
export async function findRecentJsonlFiles(
  dir: string,
  currentTranscript: string,
): Promise<string[]> {
  const now = Date.now();
  const resolved = currentTranscript ? resolve(currentTranscript) : "";

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }

  const checks = await Promise.all(
    entries
      .filter((e) => !e.isDirectory() && e.name.endsWith(".jsonl"))
      .map(async (entry) => {
        const fullPath = join(entry.parentPath, entry.name);
        if (resolve(fullPath) === resolved) return null;
        try {
          const { mtimeMs } = await stat(fullPath);
          return now - mtimeMs <= MAX_AGE_MS ? fullPath : null;
        } catch {
          return null;
        }
      }),
  );

  return checks.filter((f): f is string => f !== null);
}

async function main() {
  const API_URL = process.env.KAGAMI_API_URL;
  const API_KEY = process.env.KAGAMI_API_KEY;
  if (!API_URL) process.exit(0);

  let input: SessionStartInput;
  try {
    input = await parseStdinJson<SessionStartInput>();
  } catch {
    process.exit(0);
  }

  const currentTranscript = input.transcript_path ?? "";
  const projectsDir = join(homedir(), ".claude", "projects");

  try {
    await stat(projectsDir);
  } catch {
    process.exit(0);
  }

  // Claude Code 起動直後の CPU 競合を回避しつつ、I/O は並行で先行開始
  const [_, files, sentIds, ccVersion] = await Promise.all([
    new Promise((r) => setTimeout(r, STARTUP_DELAY_MS)),
    findRecentJsonlFiles(projectsDir, currentTranscript),
    loadSentIds(),
    resolveCcVersion(),
  ]);
  if (files.length === 0) process.exit(0);

  const unsent = files.filter((file) => !sentIds.has(sessionIdFromPath(file)));
  if (unsent.length === 0) process.exit(0);

  const results = await Promise.allSettled(
    unsent.map(async (file) => {
      const sessionId = sessionIdFromPath(file);
      const payload = await parseTranscript(file);
      if (!payload) {
        await appendSentId(sessionId);
        return;
      }
      payload.ccVersion = ccVersion;
      payload.source = "startup-send";
      const res = await sendPayload({
        apiUrl: API_URL,
        apiKey: API_KEY,
        payload,
        timeoutMs: 8000,
        signingKeyDir: SIGNING_KEY_DIR,
      });
      if (res.ok) await appendSentId(sessionId);
    }),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(`kagami: ${failed.length}/${results.length} startup-send failed`);
  }
}

if (import.meta.main) main();

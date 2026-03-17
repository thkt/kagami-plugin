/**
 * kagami SessionStart hook
 *
 * セッション開始時に直近の未送信 JSONL を検出して送信する。
 * Stop hook で送れなかったセッション（ターミナル閉じ等）の回収が目的。
 * サーバー側で sessionId の重複排除を行う前提。
 */
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { sendPayload } from "./api";
import { parseTranscript } from "./parser";
import { readStdin } from "./stdin";

const execFileAsync = promisify(execFile);

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

  const raw = await readStdin();
  let input: SessionStartInput;
  try {
    input = JSON.parse(raw);
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

  const files = await findRecentJsonlFiles(projectsDir, currentTranscript);
  if (files.length === 0) process.exit(0);

  let ccVersion = "unknown";
  try {
    const { stdout } = await execFileAsync("claude", ["--version"]);
    ccVersion = stdout.trim();
  } catch {
    // ignore: claude CLI not found
  }

  const results = await Promise.allSettled(
    files.map(async (file) => {
      const payload = await parseTranscript(file);
      if (!payload) return;
      payload.ccVersion = ccVersion;
      payload.source = "startup-send";
      await sendPayload(API_URL, API_KEY, payload, 8000);
    }),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(`kagami: ${failed.length}/${results.length} startup-send failed`);
  }
}

if (import.meta.main) main();

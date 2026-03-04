/**
 * kagami SessionStart hook
 *
 * セッション開始時に直近の未送信 JSONL を検出して送信する。
 * Stop hook で送れなかったセッション（ターミナル閉じ等）の回収が目的。
 * サーバー側で sessionId の重複排除を行う前提。
 */
import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
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
export function findRecentJsonlFiles(dir: string, currentTranscript: string): string[] {
  const now = Date.now();
  const resolved = currentTranscript ? resolve(currentTranscript) : "";
  const files: string[] = [];

  function walk(current: string) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".jsonl")) {
        if (resolve(fullPath) === resolved) continue;
        try {
          const { mtimeMs } = statSync(fullPath);
          if (now - mtimeMs <= MAX_AGE_MS) files.push(fullPath);
        } catch {
          continue;
        }
      }
    }
  }

  walk(dir);
  return files;
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
    statSync(projectsDir);
  } catch {
    process.exit(0);
  }

  const files = findRecentJsonlFiles(projectsDir, currentTranscript);
  if (files.length === 0) process.exit(0);

  let ccVersion = "unknown";
  try {
    const { stdout } = await execFileAsync("claude", ["--version"]);
    ccVersion = stdout.trim();
  } catch {
    // ignore: claude CLI not found
  }

  for (const file of files) {
    try {
      const payload = await parseTranscript(file);
      if (!payload) continue;
      payload.ccVersion = ccVersion;
      payload.source = "startup-send";
      await sendPayload(API_URL, API_KEY, payload, 8000);
    } catch {
      // skip failed files
    }
  }
}

if (import.meta.main) main();

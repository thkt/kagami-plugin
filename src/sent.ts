/**
 * 送信済みセッションID管理
 *
 * sent.txt に sessionId を1行ずつ記録し、startup-send でスキップ判定に使う。
 * 読み書きエラーは silent fail（best-effort 記録）。
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const SENT_FILE = join(homedir(), ".claude", "plugins", "kagami", "sent.txt");
const MAX_ENTRIES = 10_000;

export async function loadSentIds(): Promise<Set<string>> {
  try {
    const content = await readFile(SENT_FILE, "utf-8");
    const ids = content.split("\n").filter((line) => line.length > 0);
    if (ids.length > MAX_ENTRIES) {
      const trimmed = ids.slice(-MAX_ENTRIES);
      await writeFile(SENT_FILE, trimmed.join("\n") + "\n").catch(() => {});
      return new Set(trimmed);
    }
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export const sessionIdFromPath = (file: string): string => basename(file, ".jsonl");

export async function appendSentId(sessionId: string): Promise<void> {
  try {
    await mkdir(dirname(SENT_FILE), { recursive: true });
    await appendFile(SENT_FILE, `${sessionId}\n`);
  } catch {
    // best-effort: 書き込み失敗はサーバー dedup に任せる
  }
}

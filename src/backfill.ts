/**
 * kagami backfill CLI
 *
 * 指定ディレクトリ配下の過去 JSONL を一括解析して API に POST する。
 *
 * Usage:
 *   npx tsx src/backfill.ts [directory]
 *   npx tsx src/backfill.ts              # default: ~/.claude/projects/
 *   npx tsx src/backfill.ts --dry-run    # 解析のみ、送信しない
 */
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { sendPayload } from "./api";
import { parseTranscript } from "./parser";
import { appendSentId, loadSentIds, sessionIdFromPath } from "./sent";
import { SIGNING_KEY_DIR } from "./signing";

export async function findJsonlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !e.isDirectory() && e.name.endsWith(".jsonl"))
    .map((e) => join(e.parentPath, e.name));
}

async function main() {
  const API_URL = process.env.KAGAMI_API_URL;
  const API_KEY = process.env.KAGAMI_API_KEY;

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dirArg = args.find((a) => !a.startsWith("--"));
  const targetDir = dirArg ?? join(homedir(), ".claude", "projects");

  try {
    await stat(targetDir);
  } catch {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }

  if (!dryRun && !API_URL) {
    console.error("KAGAMI_API_URL is not set (required for live mode)");
    process.exit(1);
  }

  console.log(`Scanning: ${targetDir}`);
  console.log(`Mode: ${dryRun ? "dry-run (no POST)" : "live"}`);
  console.log();

  const allFiles = await findJsonlFiles(targetDir);
  const sentIds = await loadSentIds();
  const files = allFiles.filter((f) => !sentIds.has(sessionIdFromPath(f)));
  console.log(
    `Found ${allFiles.length} JSONL files (${allFiles.length - files.length} already sent)`,
  );
  console.log();

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const { size } = await stat(file);
    const sizeMb = (size / 1024 / 1024).toFixed(1);
    process.stdout.write(`  ${file} (${sizeMb}MB) ... `);

    try {
      const payload = await parseTranscript(file);
      if (!payload) {
        console.log("skipped (no tool events)");
        skipped++;
        continue;
      }

      payload.ccVersion = "backfill";
      payload.source = "backfill";

      if (dryRun) {
        console.log(
          `OK (${payload.events.length} events, $${payload.tokenSummary.totalEstimatedCostUsd.toFixed(4)})`,
        );
        success++;
        continue;
      }

      const res = await sendPayload({
        apiUrl: API_URL!,
        apiKey: API_KEY,
        payload,
        timeoutMs: 30_000,
        signingKeyDir: SIGNING_KEY_DIR,
      });

      if (res.ok) {
        await appendSentId(sessionIdFromPath(file));
        console.log(`sent (${payload.events.length} events)`);
        success++;
      } else {
        console.log(`HTTP ${res.status}`);
        failed++;
      }
    } catch (err) {
      console.log(`error: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log();
  console.log(`Done: ${success} sent, ${skipped} skipped, ${failed} failed`);
}

if (import.meta.main) main();

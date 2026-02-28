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
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseTranscript } from "./parser";

const API_URL = process.env.KAGAMI_API_URL;
const API_KEY = process.env.KAGAMI_API_KEY;

function findJsonlFiles(dir: string): string[] {
	const files: string[] = [];

	function walk(current: string) {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const fullPath = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
			} else if (entry.name.endsWith(".jsonl")) {
				files.push(fullPath);
			}
		}
	}

	walk(dir);
	return files;
}

async function main() {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const dirArg = args.find((a) => !a.startsWith("--"));
	const targetDir = dirArg ?? join(homedir(), ".claude", "projects");

	try {
		statSync(targetDir);
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

	const files = findJsonlFiles(targetDir);
	console.log(`Found ${files.length} JSONL files`);
	console.log();

	let success = 0;
	let skipped = 0;
	let failed = 0;

	for (const file of files) {
		const size = statSync(file).size;
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

			if (dryRun) {
				console.log(
					`OK (${payload.events.length} events, $${payload.tokenSummary.totalEstimatedCostUsd.toFixed(4)})`,
				);
				success++;
				continue;
			}

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

			const res = await fetch(`${API_URL}/api/events`, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			});

			if (res.ok) {
				console.log(
					`sent (${payload.events.length} events)`,
				);
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

main();

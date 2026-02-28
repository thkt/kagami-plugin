import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { parseTranscript } from "../parser";

const REAL_SESSION =
	"/Users/thkt/.claude/projects/-Users-thkt-GitHub-okr-dashboard/5a2bada6-bdf4-4599-abd9-fd246f992a1e.jsonl";

describe("parseTranscript with real session", () => {
	test.skipIf(!existsSync(REAL_SESSION))(
		"parses a real okr-dashboard session",
		async () => {
			const result = await parseTranscript(REAL_SESSION);

			expect(result).not.toBeNull();
			expect(result!.sessionId).toBeTruthy();
			expect(result!.events.length).toBeGreaterThan(0);

			// カテゴリ分布を確認
			const categories = new Set(result!.events.map((e) => e.category));
			console.log(
				"Categories found:",
				[...categories].join(", "),
			);
			console.log("Total events:", result!.events.length);
			console.log(
				"Models:",
				Object.keys(result!.tokenSummary.byModel).join(", "),
			);
			console.log(
				"Estimated cost: $" +
					result!.tokenSummary.totalEstimatedCostUsd.toFixed(4),
			);

			// 全カテゴリが有効な値であること
			for (const event of result!.events) {
				expect(["skill", "subagent", "mcp", "builtin"]).toContain(
					event.category,
				);
				expect(event.toolName).toBeTruthy();
				expect(event.model).toBeTruthy();
			}
		},
	);
});

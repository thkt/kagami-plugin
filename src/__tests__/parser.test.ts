import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { categorize, extractSkillName, parseTranscript } from "../parser";

// --- categorize (FR-002) ---

describe("categorize", () => {
	test("Skill → skill", () => {
		expect(categorize("Skill", { skill: "commit" })).toBe("skill");
	});

	test("Agent with subagent_type → subagent", () => {
		expect(categorize("Agent", { subagent_type: "Explore" })).toBe("subagent");
	});

	test("Agent without subagent_type → builtin", () => {
		expect(categorize("Agent", {})).toBe("builtin");
	});

	test("mcp__ prefix → mcp", () => {
		expect(categorize("mcp__scout__search", { query: "test" })).toBe("mcp");
	});

	test("Read → builtin", () => {
		expect(categorize("Read", { file_path: "/tmp/test" })).toBe("builtin");
	});

	test("Edit → builtin", () => {
		expect(categorize("Edit", {})).toBe("builtin");
	});

	test("Bash → builtin", () => {
		expect(categorize("Bash", { command: "ls" })).toBe("builtin");
	});
});

// --- extractSkillName ---

describe("extractSkillName", () => {
	test("extracts name from '# /<name> - <description>' header", () => {
		const content = [
			{ type: "text" as const, text: "# /commit - Git Commit Message Generator\n\nAnalyze staged changes..." },
		];
		expect(extractSkillName(content)).toBe("commit");
	});

	test("extracts name with hyphen (e.g. /review-pr)", () => {
		const content = [
			{ type: "text" as const, text: "# /review-pr - PR Review\n\nReview pull requests..." },
		];
		expect(extractSkillName(content)).toBe("review-pr");
	});

	test("returns null for nested skill invocation (no slash prefix)", () => {
		const content = [
			{ type: "text" as const, text: "# Simplify: Code Review and Cleanup\n\nReview all changed files..." },
		];
		expect(extractSkillName(content)).toBeNull();
	});

	test("returns null for local-command-caveat", () => {
		// local-command-caveat は string content → ContentBlock[] に変換されない
		// 仮に text ブロックに入っていてもマッチしない
		const content = [
			{ type: "text" as const, text: "<local-command-caveat>Caveat: ...</local-command-caveat>" },
		];
		expect(extractSkillName(content)).toBeNull();
	});

	test("returns null for empty content", () => {
		expect(extractSkillName([])).toBeNull();
	});
});

// --- parseTranscript (FR-001, FR-003) ---

function createJsonlFile(lines: object[]): string {
	const dir = mkdtempSync(join(tmpdir(), "kagami-test-"));
	const path = join(dir, "session.jsonl");
	const content = lines.map((l) => JSON.stringify(l)).join("\n");
	writeFileSync(path, content);
	return path;
}

describe("parseTranscript", () => {
	test("extracts tool_use events from assistant messages", async () => {
		const path = createJsonlFile([
			{
				type: "user",
				sessionId: "test-session-123",
				cwd: "/tmp/project",
				gitBranch: "main",
				timestamp: "2026-02-28T10:00:00Z",
				message: { role: "user", content: [{ type: "text", text: "hello" }] },
			},
			{
				type: "assistant",
				sessionId: "test-session-123",
				timestamp: "2026-02-28T10:00:01Z",
				message: {
					role: "assistant",
					model: "claude-opus-4-6",
					usage: {
						input_tokens: 100,
						output_tokens: 50,
						cache_creation_input_tokens: 200,
						cache_read_input_tokens: 30,
					},
					content: [
						{ type: "text", text: "Let me read that file." },
						{
							type: "tool_use",
							id: "tu1",
							name: "Read",
							input: { file_path: "/tmp/test.ts" },
						},
					],
				},
			},
			{
				type: "assistant",
				sessionId: "test-session-123",
				timestamp: "2026-02-28T10:00:05Z",
				message: {
					role: "assistant",
					model: "claude-opus-4-6",
					usage: {
						input_tokens: 150,
						output_tokens: 80,
						cache_creation_input_tokens: 0,
						cache_read_input_tokens: 300,
					},
					content: [
						{
							type: "tool_use",
							id: "tu2",
							name: "Skill",
							input: { skill: "commit" },
						},
					],
				},
			},
		]);

		const result = await parseTranscript(path);

		expect(result).not.toBeNull();
		expect(result!.sessionId).toBe("test-session-123");
		expect(result!.cwd).toBe("/tmp/project");
		expect(result!.gitBranch).toBe("main");
		expect(result!.events).toHaveLength(2);

		// First event: Read → builtin
		expect(result!.events[0].category).toBe("builtin");
		expect(result!.events[0].toolName).toBe("Read");
		expect(result!.events[0].model).toBe("claude-opus-4-6");

		// Second event: Skill → skill
		expect(result!.events[1].category).toBe("skill");
		expect(result!.events[1].toolName).toBe("commit");

		// Token summary
		expect(result!.tokenSummary.byModel["claude-opus-4-6"]).toBeDefined();
		const opus = result!.tokenSummary.byModel["claude-opus-4-6"];
		expect(opus.inputTokens).toBe(250); // 100 + 150
		expect(opus.outputTokens).toBe(130); // 50 + 80
		expect(opus.estimatedCostUsd).toBeGreaterThan(0);
		expect(result!.tokenSummary.totalEstimatedCostUsd).toBeGreaterThan(0);
	});

	test("produces events for isMeta-only session (no tool_use)", async () => {
		const path = createJsonlFile([
			{
				type: "user",
				sessionId: "meta-only",
				cwd: "/tmp",
				timestamp: "2026-02-28T10:00:00Z",
				isMeta: true,
				message: {
					role: "user",
					content: [
						{ type: "text", text: "# /audit - Code Audit\n\nOrchestrate review agents..." },
					],
				},
			},
		]);

		const result = await parseTranscript(path);
		expect(result).not.toBeNull();
		expect(result!.events).toHaveLength(1);
		expect(result!.events[0].category).toBe("skill");
		expect(result!.events[0].toolName).toBe("audit");
	});

	test("returns null for empty sessions", async () => {
		const path = createJsonlFile([
			{
				type: "user",
				sessionId: "empty-session",
				timestamp: "2026-02-28T10:00:00Z",
				message: { role: "user", content: [{ type: "text", text: "hello" }] },
			},
			{
				type: "assistant",
				sessionId: "empty-session",
				timestamp: "2026-02-28T10:00:01Z",
				message: {
					role: "assistant",
					model: "claude-opus-4-6",
					usage: { input_tokens: 100, output_tokens: 50 },
					content: [{ type: "text", text: "Hello!" }],
				},
			},
		]);

		const result = await parseTranscript(path);
		expect(result).toBeNull(); // no tool_use events
	});

	test("handles MCP and Agent subagent tools", async () => {
		const path = createJsonlFile([
			{
				type: "assistant",
				sessionId: "mixed-session",
				cwd: "/tmp",
				timestamp: "2026-02-28T10:00:00Z",
				message: {
					role: "assistant",
					model: "claude-sonnet-4-6",
					usage: { input_tokens: 50, output_tokens: 20 },
					content: [
						{
							type: "tool_use",
							id: "tu1",
							name: "mcp__scout__search",
							input: { query: "react hooks" },
						},
						{
							type: "tool_use",
							id: "tu2",
							name: "Agent",
							input: {
								subagent_type: "Explore",
								description: "Find auth files",
								prompt: "...",
							},
						},
					],
				},
			},
		]);

		const result = await parseTranscript(path);
		expect(result).not.toBeNull();
		expect(result!.events).toHaveLength(2);
		expect(result!.events[0].category).toBe("mcp");
		expect(result!.events[0].toolName).toBe("mcp__scout__search");
		expect(result!.events[1].category).toBe("subagent");
		expect(result!.events[1].toolName).toBe("Explore");
	});

	test("detects slash command invocations via isMeta: true", async () => {
		const path = createJsonlFile([
			{
				type: "user",
				sessionId: "meta-session",
				cwd: "/tmp/project",
				timestamp: "2026-02-28T10:00:00Z",
				isMeta: true,
				message: {
					role: "user",
					content: [
						{
							type: "text",
							text: "# /commit - Git Commit Message Generator\n\nAnalyze staged changes...",
						},
					],
				},
			},
			{
				type: "assistant",
				sessionId: "meta-session",
				timestamp: "2026-02-28T10:00:01Z",
				message: {
					role: "assistant",
					model: "claude-opus-4-6",
					usage: { input_tokens: 100, output_tokens: 50 },
					content: [
						{
							type: "tool_use",
							id: "tu1",
							name: "Agent",
							input: { subagent_type: "commit-generator", prompt: "..." },
						},
					],
				},
			},
		]);

		const result = await parseTranscript(path);
		expect(result).not.toBeNull();
		expect(result!.events).toHaveLength(2);

		// isMeta → skill
		expect(result!.events[0].category).toBe("skill");
		expect(result!.events[0].toolName).toBe("commit");
		expect(result!.events[0].inputTokens).toBe(0);

		// Agent → subagent
		expect(result!.events[1].category).toBe("subagent");
		expect(result!.events[1].toolName).toBe("commit-generator");
	});

	test("ignores isMeta: true without slash command header", async () => {
		const path = createJsonlFile([
			{
				type: "user",
				sessionId: "caveat-session",
				cwd: "/tmp/project",
				timestamp: "2026-02-28T10:00:00Z",
				isMeta: true,
				message: {
					role: "user",
					content: "<local-command-caveat>Caveat: ...</local-command-caveat>",
				},
			},
			{
				type: "assistant",
				sessionId: "caveat-session",
				timestamp: "2026-02-28T10:00:01Z",
				message: {
					role: "assistant",
					model: "claude-opus-4-6",
					usage: { input_tokens: 50, output_tokens: 20 },
					content: [
						{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/tmp/a.ts" } },
					],
				},
			},
		]);

		const result = await parseTranscript(path);
		expect(result).not.toBeNull();
		// local-command-caveat はスキルではないのでスキップ
		expect(result!.events).toHaveLength(1);
		expect(result!.events[0].category).toBe("builtin");
		expect(result!.events[0].toolName).toBe("Read");
	});

	test("skips malformed lines gracefully", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kagami-test-"));
		const path = join(dir, "session.jsonl");
		const lines = [
			JSON.stringify({
				type: "assistant",
				sessionId: "skip-test",
				cwd: "/tmp",
				timestamp: "2026-02-28T10:00:00Z",
				message: {
					role: "assistant",
					model: "claude-opus-4-6",
					usage: { input_tokens: 10, output_tokens: 5 },
					content: [
						{
							type: "tool_use",
							id: "tu1",
							name: "Bash",
							input: { command: "ls" },
						},
					],
				},
			}),
			"this is not valid json",
			"",
			JSON.stringify({
				type: "assistant",
				sessionId: "skip-test",
				timestamp: "2026-02-28T10:00:02Z",
				message: {
					role: "assistant",
					model: "claude-opus-4-6",
					usage: { input_tokens: 10, output_tokens: 5 },
					content: [
						{
							type: "tool_use",
							id: "tu2",
							name: "Glob",
							input: { pattern: "*.ts" },
						},
					],
				},
			}),
		];
		writeFileSync(path, lines.join("\n"));

		const result = await parseTranscript(path);
		expect(result).not.toBeNull();
		expect(result!.events).toHaveLength(2);
	});
});

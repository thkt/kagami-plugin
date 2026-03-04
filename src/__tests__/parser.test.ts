import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  categorize,
  deterministicUuid,
  extractBashToolName,
  extractSkillName,
  parseTranscript,
  truncateEvents,
} from "../parser";
import type { ToolEventInput } from "../types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministicUuid", () => {
  test("produces valid UUID v4 format", () => {
    const result = deterministicUuid("550e8400-e29b-41d4-a716-446655440000", "agent-1");
    expect(result).toMatch(UUID_RE);
  });

  test("is deterministic (same inputs → same output)", () => {
    const a = deterministicUuid("550e8400-e29b-41d4-a716-446655440000", "agent-1");
    const b = deterministicUuid("550e8400-e29b-41d4-a716-446655440000", "agent-1");
    expect(a).toBe(b);
  });

  test("different inputs → different UUIDs", () => {
    const a = deterministicUuid("550e8400-e29b-41d4-a716-446655440000", "agent-1");
    const b = deterministicUuid("550e8400-e29b-41d4-a716-446655440000", "agent-2");
    expect(a).not.toBe(b);
  });

  test("differs from original namespace UUID", () => {
    const ns = "550e8400-e29b-41d4-a716-446655440000";
    const result = deterministicUuid(ns, "agent-1");
    expect(result).not.toBe(ns);
  });
});

describe("categorize", () => {
  test("Skill → skill", () => {
    expect(categorize("Skill", { skill: "commit" })).toBe("skill");
  });

  test("Agent with subagent_type → subagent", () => {
    expect(categorize("Agent", { subagent_type: "Explore" })).toBe("subagent");
  });

  test("Agent without subagent_type → null (skip)", () => {
    expect(categorize("Agent", {})).toBeNull();
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

  test("Bash → cli", () => {
    expect(categorize("Bash", { command: "ls" })).toBe("cli");
  });

  test("Write → builtin", () => {
    expect(categorize("Write", { file_path: "/tmp/a.ts", content: "..." })).toBe("builtin");
  });

  test("Grep → builtin", () => {
    expect(categorize("Grep", { pattern: "foo" })).toBe("builtin");
  });

  test("Glob → builtin", () => {
    expect(categorize("Glob", { pattern: "*.ts" })).toBe("builtin");
  });

  test("WebSearch → builtin", () => {
    expect(categorize("WebSearch", { query: "react" })).toBe("builtin");
  });

  test("UnknownTool → null", () => {
    expect(categorize("UnknownTool", {})).toBeNull();
  });
});

describe("extractSkillName", () => {
  test("extracts name from '# /<name> - <description>' header", () => {
    const content = [
      {
        type: "text" as const,
        text: "# /commit - Git Commit Message Generator\n\nAnalyze staged changes...",
      },
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
      {
        type: "text" as const,
        text: "# Simplify: Code Review and Cleanup\n\nReview all changed files...",
      },
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

describe("extractBashToolName", () => {
  test("simple command", () => {
    expect(extractBashToolName("git status")).toBe("git");
  });

  test("CLI tool with args", () => {
    expect(extractBashToolName('scout search "query"')).toBe("scout");
  });

  test("yomu search", () => {
    expect(extractBashToolName('yomu search "hooks"')).toBe("yomu");
  });

  test("full path → basename", () => {
    expect(extractBashToolName("/usr/bin/git log")).toBe("git");
  });

  test("env var prefix → skip to command", () => {
    expect(extractBashToolName("SOME_VAR=val npm install")).toBe("npm");
  });

  test("leading whitespace", () => {
    expect(extractBashToolName("  ls -la  ")).toBe("ls");
  });

  test("multiple env vars", () => {
    expect(extractBashToolName("A=1 B=2 bun test")).toBe("bun");
  });

  test("empty string → Bash fallback", () => {
    expect(extractBashToolName("")).toBe("Bash");
  });

  test("whitespace only → Bash fallback", () => {
    expect(extractBashToolName("   ")).toBe("Bash");
  });

  test("comment (#) → Bash fallback", () => {
    expect(extractBashToolName("# this is a comment")).toBe("Bash");
  });

  test("chained (&&) → Bash fallback", () => {
    expect(extractBashToolName("&& git status")).toBe("Bash");
  });

  test("flag (-u) → Bash fallback", () => {
    expect(extractBashToolName("-u origin main")).toBe("Bash");
  });

  test("brace ({) → Bash fallback", () => {
    expect(extractBashToolName("{ echo hello; }")).toBe("Bash");
  });

  test("bracket ([) → Bash fallback", () => {
    expect(extractBashToolName("[ -f file.txt ]")).toBe("Bash");
  });
});

describe("truncateEvents", () => {
  function makeEvent(category: ToolEventInput["category"], toolName: string): ToolEventInput {
    return {
      category,
      toolName,
      toolInput: null,
      model: "claude-opus-4-6",
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      timestamp: "2026-02-28T10:00:00Z",
    };
  }

  test("returns all events when under limit", () => {
    const events = [makeEvent("skill", "commit"), makeEvent("builtin", "Read")];
    expect(truncateEvents(events, 500)).toHaveLength(2);
  });

  test("preserves skill/subagent/mcp and truncates builtin", () => {
    const skills = Array.from({ length: 10 }, (_, i) => makeEvent("skill", `s${i}`));
    const builtins = Array.from({ length: 100 }, (_, i) => makeEvent("builtin", `b${i}`));
    const events = [...skills, ...builtins];

    const result = truncateEvents(events, 50);
    expect(result).toHaveLength(50);
    expect(result.filter((e) => e.category === "skill")).toHaveLength(10);
    expect(result.filter((e) => e.category === "builtin")).toHaveLength(40);
  });

  test("truncates cli alongside builtin as low priority", () => {
    const skills = Array.from({ length: 10 }, (_, i) => makeEvent("skill", `s${i}`));
    const cliEvents = Array.from({ length: 300 }, (_, i) => makeEvent("cli", `cli${i}`));
    const builtins = Array.from({ length: 290 }, (_, i) => makeEvent("builtin", `b${i}`));
    const events = [...skills, ...cliEvents, ...builtins];

    const result = truncateEvents(events, 500);
    expect(result).toHaveLength(500);
    expect(result.filter((e) => e.category === "skill")).toHaveLength(10);
    const lowPriorityCount = result.filter(
      (e) => e.category === "cli" || e.category === "builtin",
    ).length;
    expect(lowPriorityCount).toBe(490);
  });

  test("truncates builtin-first then cli order preserving early low-priority", () => {
    const builtins = Array.from({ length: 5 }, (_, i) => makeEvent("builtin", `b${i}`));
    const cliEvents = Array.from({ length: 5 }, (_, i) => makeEvent("cli", `cli${i}`));
    const skills = Array.from({ length: 5 }, (_, i) => makeEvent("skill", `s${i}`));
    // builtin が先、cli が後
    const events = [...builtins, ...cliEvents, ...skills];

    const result = truncateEvents(events, 12);
    expect(result).toHaveLength(12);
    expect(result.filter((e) => e.category === "skill")).toHaveLength(5);
    // 低優先度は先頭寄り（早い時系列）が残る
    const lowPriority = result.filter((e) => e.category === "builtin" || e.category === "cli");
    expect(lowPriority).toHaveLength(7);
    expect(lowPriority[0].toolName).toBe("b0");
  });

  test("caps at max even when priority alone exceeds limit", () => {
    const skills = Array.from({ length: 60 }, (_, i) => makeEvent("skill", `s${i}`));
    const builtins = Array.from({ length: 10 }, (_, i) => makeEvent("builtin", `b${i}`));
    const events = [...skills, ...builtins];

    const result = truncateEvents(events, 50);
    expect(result).toHaveLength(50);
    expect(result.filter((e) => e.category === "skill")).toHaveLength(50);
    expect(result.filter((e) => e.category === "builtin")).toHaveLength(0);
  });

  test("preserves chronological order after truncation", () => {
    const events: ToolEventInput[] = [
      makeEvent("skill", "s0"),
      makeEvent("builtin", "Read"),
      makeEvent("mcp", "mcp__scout__search"),
      makeEvent("builtin", "Grep"),
      makeEvent("skill", "s1"),
    ];

    const result = truncateEvents(events, 4);
    expect(result).toHaveLength(4);
    expect(result.map((e) => e.toolName)).toEqual(["s0", "Read", "mcp__scout__search", "s1"]);
  });
});

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

    expect(result!.events[0].category).toBe("builtin");
    expect(result!.events[0].toolName).toBe("Read");
    expect(result!.events[0].toolInput).toBeNull();

    expect(result!.events[1].category).toBe("skill");
    expect(result!.events[1].toolName).toBe("commit");
    expect(result!.events[1].toolInput).toEqual({ skill: "commit" });

    expect(result!.tokenSummary.byModel["claude-opus-4-6"]).toBeDefined();
    const opus = result!.tokenSummary.byModel["claude-opus-4-6"];
    expect(opus.inputTokens).toBe(250); // 100 + 150
    expect(opus.outputTokens).toBe(130); // 50 + 80
    expect(opus.estimatedCostUsd).toBeGreaterThan(0);
    expect(result!.tokenSummary.totalEstimatedCostUsd).toBeGreaterThan(0);
  });

  test("returns null for isMeta-only session without assistant response (unknown model)", async () => {
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
    expect(result).toBeNull();
  });

  test("backfills empty model on skill events from subsequent assistant response", async () => {
    const path = createJsonlFile([
      {
        type: "user",
        sessionId: "model-backfill",
        cwd: "/tmp",
        timestamp: "2026-02-28T10:00:00Z",
        isMeta: true,
        message: {
          role: "user",
          content: [{ type: "text", text: "# /commit - Git Commit\n\nAnalyze..." }],
        },
      },
      {
        type: "assistant",
        sessionId: "model-backfill",
        timestamp: "2026-02-28T10:00:01Z",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/tmp/a.ts" } },
          ],
        },
      },
    ]);

    const result = await parseTranscript(path);
    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(2);
    expect(result!.events[0].category).toBe("skill");
    expect(result!.events[0].model).toBe("claude-opus-4-6");
  });

  test("filters out events with empty model when no assistant message exists", async () => {
    const path = createJsonlFile([
      {
        type: "user",
        sessionId: "no-assistant",
        cwd: "/tmp",
        timestamp: "2026-02-28T10:00:00Z",
        isMeta: true,
        message: {
          role: "user",
          content: [{ type: "text", text: "# /audit - Code Audit\n\nOrchestrate..." }],
        },
      },
    ]);

    const result = await parseTranscript(path);
    expect(result).toBeNull();
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

    // tokens are split across tool_uses in the same message
    expect(result!.events[0].inputTokens).toBe(25);
    expect(result!.events[0].outputTokens).toBe(10);
    expect(result!.events[1].inputTokens).toBe(25);
    expect(result!.events[1].outputTokens).toBe(10);
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

    expect(result!.events[0].category).toBe("skill");
    expect(result!.events[0].toolName).toBe("commit");
    expect(result!.events[0].inputTokens).toBe(0);

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
    expect(result!.events).toHaveLength(1);
    expect(result!.events[0].category).toBe("builtin");
    expect(result!.events[0].toolName).toBe("Read");
    expect(result!.events[0].toolInput).toBeNull();
  });

  test("extracts CLI tool name from Bash commands", async () => {
    const path = createJsonlFile([
      {
        type: "assistant",
        sessionId: "bash-session",
        cwd: "/tmp",
        timestamp: "2026-02-28T10:00:00Z",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 50, output_tokens: 20 },
          content: [
            {
              type: "tool_use",
              id: "tu1",
              name: "Bash",
              input: { command: "git status" },
            },
            {
              type: "tool_use",
              id: "tu2",
              name: "Bash",
              input: { command: 'scout search "react hooks"' },
            },
          ],
        },
      },
    ]);

    const result = await parseTranscript(path);
    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(2);
    expect(result!.events[0].category).toBe("cli");
    expect(result!.events[0].toolName).toBe("git");
    expect(result!.events[1].category).toBe("cli");
    expect(result!.events[1].toolName).toBe("scout");
    expect(result!.events[0].toolInput).toBeNull();
    expect(result!.events[1].toolInput).toBeNull();
  });

  test("generates deterministic UUID sessionId for subagent JSONL", async () => {
    const path = createJsonlFile([
      {
        type: "user",
        sessionId: "parent-session-abc",
        agentId: "a14aaf1",
        cwd: "/tmp/project",
        timestamp: "2026-02-28T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Translate files" }],
        },
      },
      {
        type: "assistant",
        sessionId: "parent-session-abc",
        agentId: "a14aaf1",
        timestamp: "2026-02-28T10:00:01Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            {
              type: "tool_use",
              id: "tu1",
              name: "mcp__scout__fetch",
              input: { url: "https://example.com" },
            },
          ],
        },
      },
    ]);

    const result = await parseTranscript(path);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toMatch(UUID_RE);
    expect(result!.sessionId).not.toBe("parent-session-abc");
    expect(result!.sessionId).toBe(deterministicUuid("parent-session-abc", "a14aaf1"));
    expect(result!.events).toHaveLength(1);
    expect(result!.events[0].category).toBe("mcp");
  });

  test("keeps original sessionId when no agentId (parent session)", async () => {
    const path = createJsonlFile([
      {
        type: "assistant",
        sessionId: "parent-session-abc",
        cwd: "/tmp",
        timestamp: "2026-02-28T10:00:00Z",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 50, output_tokens: 20 },
          content: [
            {
              type: "tool_use",
              id: "tu1",
              name: "Skill",
              input: { skill: "commit" },
            },
          ],
        },
      },
    ]);

    const result = await parseTranscript(path);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("parent-session-abc");
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
              name: "mcp__scout__search",
              input: { query: "test" },
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
              name: "mcp__scout__fetch",
              input: { url: "https://example.com" },
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

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sessionIdFromPath } from "../sent";

const MAX_ENTRIES = 10_000;

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "kagami-sent-test-"));
}

// SENT_FILE がハードコードのため、同じロジックをパス差し替え可能な形で検証
async function loadSentIds(sentFile: string): Promise<Set<string>> {
  try {
    const content = await readFile(sentFile, "utf-8");
    const ids = content.split("\n").filter((line) => line.length > 0);
    if (ids.length > MAX_ENTRIES) {
      const trimmed = ids.slice(-MAX_ENTRIES);
      await writeFile(sentFile, trimmed.join("\n") + "\n").catch(() => {});
      return new Set(trimmed);
    }
    return new Set(ids);
  } catch {
    return new Set();
  }
}

async function appendSentId(sentFile: string, sessionId: string): Promise<void> {
  try {
    await mkdir(dirname(sentFile), { recursive: true });
    await appendFile(sentFile, `${sessionId}\n`);
  } catch {}
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeSentFile(...segments: string[]): string {
  const dir = createTempDir();
  tempDirs.push(dir);
  return join(dir, ...segments, "sent.txt");
}

describe("loadSentIds", () => {
  test("reads IDs from file with 3 lines", async () => {
    const sentFile = makeSentFile();
    writeFileSync(sentFile, "a\nb\nc\n");

    const ids = await loadSentIds(sentFile);
    expect(ids).toEqual(new Set(["a", "b", "c"]));
  });

  test("returns empty set for non-existent file", async () => {
    const ids = await loadSentIds("/tmp/does-not-exist-kagami-sent-test/sent.txt");
    expect(ids.size).toBe(0);
  });

  test("returns empty set for empty file", async () => {
    const sentFile = makeSentFile();
    writeFileSync(sentFile, "");

    const ids = await loadSentIds(sentFile);
    expect(ids.size).toBe(0);
  });

  test("handles file without trailing newline", async () => {
    const sentFile = makeSentFile();
    writeFileSync(sentFile, "a\nb");

    const ids = await loadSentIds(sentFile);
    expect(ids).toEqual(new Set(["a", "b"]));
  });

  test("trims to last MAX_ENTRIES when exceeding threshold", async () => {
    const sentFile = makeSentFile();
    const lines = Array.from({ length: MAX_ENTRIES + 500 }, (_, i) => `id-${i}`);
    writeFileSync(sentFile, lines.join("\n") + "\n");

    const ids = await loadSentIds(sentFile);
    expect(ids.size).toBe(MAX_ENTRIES);
    expect(ids.has(`id-${MAX_ENTRIES + 499}`)).toBe(true);
    expect(ids.has("id-0")).toBe(false);

    const content = readFileSync(sentFile, "utf-8");
    const rewrittenLines = content.split("\n").filter((l) => l.length > 0);
    expect(rewrittenLines).toHaveLength(MAX_ENTRIES);
  });
});

describe("appendSentId", () => {
  test("appends to existing file", async () => {
    const sentFile = makeSentFile();
    writeFileSync(sentFile, "existing\n");

    await appendSentId(sentFile, "new-id");

    const content = readFileSync(sentFile, "utf-8");
    expect(content).toBe("existing\nnew-id\n");
  });

  test("creates file if not exists", async () => {
    const sentFile = makeSentFile();

    await appendSentId(sentFile, "first-id");

    const content = readFileSync(sentFile, "utf-8");
    expect(content).toBe("first-id\n");
  });

  test("creates nested directory structure", async () => {
    const sentFile = makeSentFile("nested", "deep");

    await appendSentId(sentFile, "deep-id");

    const content = readFileSync(sentFile, "utf-8");
    expect(content).toBe("deep-id\n");
  });
});

describe("sessionIdFromPath", () => {
  test.each([
    ["/path/to/abc-123.jsonl", "abc-123"],
    ["session.jsonl", "session"],
  ])("extracts session ID from %s", (path, expected) => {
    expect(sessionIdFromPath(path)).toBe(expected);
  });
});

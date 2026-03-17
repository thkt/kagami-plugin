import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRecentJsonlFiles } from "../startup-send";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "kagami-startup-test-"));
}

function createFile(dir: string, name: string, ageMs = 0): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, "{}");
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    utimesSync(filePath, past, past);
  }
  return filePath;
}

describe("findRecentJsonlFiles", () => {
  test("finds .jsonl files within 48h", async () => {
    const dir = createTempDir();
    createFile(dir, "a.jsonl");
    createFile(dir, "b.jsonl");

    const files = await findRecentJsonlFiles(dir, "");
    expect(files).toHaveLength(2);
  });

  test("excludes files older than 48h", async () => {
    const dir = createTempDir();
    createFile(dir, "recent.jsonl");
    createFile(dir, "old.jsonl", 49 * 60 * 60 * 1000); // 49h ago

    const files = await findRecentJsonlFiles(dir, "");
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("recent.jsonl");
  });

  test("excludes currentTranscript", async () => {
    const dir = createTempDir();
    const current = createFile(dir, "current.jsonl");
    createFile(dir, "other.jsonl");

    const files = await findRecentJsonlFiles(dir, current);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("other.jsonl");
  });

  test("excludes currentTranscript with path.resolve normalization", async () => {
    const dir = createTempDir();
    createFile(dir, "current.jsonl");
    createFile(dir, "other.jsonl");

    // ./dir/../dir/current.jsonl のような非正規化パスで除外できるか
    const nonNormalized = join(dir, "..", dir.split("/").pop()!, "current.jsonl");
    const files = await findRecentJsonlFiles(dir, nonNormalized);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("other.jsonl");
  });

  test("ignores non-.jsonl files", async () => {
    const dir = createTempDir();
    createFile(dir, "session.jsonl");
    createFile(dir, "notes.txt");
    createFile(dir, "data.json");

    const files = await findRecentJsonlFiles(dir, "");
    expect(files).toHaveLength(1);
  });

  test("recurses into subdirectories", async () => {
    const dir = createTempDir();
    const sub = join(dir, "project-a");
    mkdirSync(sub);
    createFile(dir, "root.jsonl");
    createFile(sub, "nested.jsonl");

    const files = await findRecentJsonlFiles(dir, "");
    expect(files).toHaveLength(2);
  });

  test("returns empty for non-existent directory", async () => {
    const files = await findRecentJsonlFiles("/tmp/does-not-exist-kagami-test", "");
    expect(files).toHaveLength(0);
  });

  test("returns empty for directory with no .jsonl files", async () => {
    const dir = createTempDir();
    createFile(dir, "readme.md");

    const files = await findRecentJsonlFiles(dir, "");
    expect(files).toHaveLength(0);
  });
});

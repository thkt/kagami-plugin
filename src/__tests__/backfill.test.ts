import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findJsonlFiles } from "../backfill";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "kagami-backfill-test-"));
}

function createFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, "{}");
  return filePath;
}

describe("findJsonlFiles", () => {
  test("finds .jsonl files", async () => {
    const dir = createTempDir();
    createFile(dir, "a.jsonl");
    createFile(dir, "b.jsonl");

    const files = await findJsonlFiles(dir);
    expect(files).toHaveLength(2);
  });

  test("ignores non-.jsonl files", async () => {
    const dir = createTempDir();
    createFile(dir, "session.jsonl");
    createFile(dir, "notes.txt");
    createFile(dir, "data.json");

    const files = await findJsonlFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("session.jsonl");
  });

  test("recurses into subdirectories", async () => {
    const dir = createTempDir();
    const sub = join(dir, "project-a");
    mkdirSync(sub);
    createFile(dir, "root.jsonl");
    createFile(sub, "nested.jsonl");

    const files = await findJsonlFiles(dir);
    expect(files).toHaveLength(2);
  });

  test("returns empty for non-existent directory", async () => {
    const files = await findJsonlFiles("/tmp/does-not-exist-kagami-backfill-test");
    expect(files).toHaveLength(0);
  });

  test("returns empty for directory with no .jsonl files", async () => {
    const dir = createTempDir();
    createFile(dir, "readme.md");

    const files = await findJsonlFiles(dir);
    expect(files).toHaveLength(0);
  });

  test("returns absolute paths", async () => {
    const dir = createTempDir();
    createFile(dir, "test.jsonl");

    const files = await findJsonlFiles(dir);
    expect(files[0]).toMatch(/^\//);
    expect(files[0]).toEndWith(".jsonl");
  });
});

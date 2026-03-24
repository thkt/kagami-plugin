import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readStdin } from "./stdin";

export const execFileAsync = promisify(execFile);

export async function resolveCcVersion(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("claude", ["--version"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

export async function parseStdinJson<T>(): Promise<T> {
  const raw = await readStdin();
  return JSON.parse(raw) as T;
}

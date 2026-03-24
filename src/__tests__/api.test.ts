import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventPayload } from "../types";
import { ensureKeyPair, verifyPayload } from "../signing";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "kagami-api-"));
}

function makePayload(overrides?: Partial<EventPayload>): EventPayload {
  return {
    sessionId: "test-session",
    userId: "test-user",
    cwd: "/tmp",
    gitBranch: null,
    ccVersion: "test",
    sessionStartedAt: "2025-01-01T00:00:00Z",
    sessionEndedAt: "2025-01-01T01:00:00Z",
    events: [],
    hookSummaries: [],
    tokenSummary: { byModel: {}, totalEstimatedCostUsd: 0 },
    messageSummary: { userMessages: 0, assistantMessages: 0 },
    ...overrides,
  };
}

let captured: { url: string; init: RequestInit } | null = null;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  captured = null;
});

function stubFetch(status = 200) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response("{}", { status });
  }) as typeof fetch;
}

describe("sendPayload", () => {
  test("adds X-Kagami-Signature header when signingKeyDir provided", async () => {
    const dir = makeTmpDir();
    try {
      stubFetch();
      const { sendPayload } = await import("../api");

      await sendPayload({
        apiUrl: "http://localhost",
        apiKey: "key",
        payload: makePayload(),
        signingKeyDir: dir,
      });

      expect(captured).not.toBeNull();
      const headers = captured!.init.headers as Record<string, string>;
      expect(headers["X-Kagami-Signature"].length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("signature verifies against body with generated public key", async () => {
    const dir = makeTmpDir();
    try {
      stubFetch();
      const { sendPayload } = await import("../api");
      const payload = makePayload();

      await sendPayload({
        apiUrl: "http://localhost",
        apiKey: "key",
        payload,
        signingKeyDir: dir,
      });

      const body = captured!.init.body as string;
      const headers = captured!.init.headers as Record<string, string>;
      const signature = headers["X-Kagami-Signature"];
      const { publicKey } = ensureKeyPair(dir);

      expect(verifyPayload(body, signature, publicKey)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("still sends when signingKeyDir is omitted", async () => {
    stubFetch();
    const { sendPayload } = await import("../api");

    await sendPayload({
      apiUrl: "http://localhost",
      apiKey: "key",
      payload: makePayload(),
    });

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("http://localhost/api/events");
  });

  test("preserves Authorization header", async () => {
    const dir = makeTmpDir();
    try {
      stubFetch();
      const { sendPayload } = await import("../api");

      await sendPayload({
        apiUrl: "http://localhost",
        apiKey: "my-key",
        payload: makePayload(),
        signingKeyDir: dir,
      });

      const headers = captured!.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer my-key");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("sends without signature when signing fails (graceful degradation)", async () => {
    stubFetch();
    const { sendPayload } = await import("../api");

    await sendPayload({
      apiUrl: "http://localhost",
      apiKey: "key",
      payload: makePayload(),
      signingKeyDir: "/dev/null/impossible",
    });

    expect(captured).not.toBeNull();
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers["X-Kagami-Signature"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("T-001: adds X-Kagami-Public-Key header when signingKeyDir provided", async () => {
    const dir = makeTmpDir();
    try {
      stubFetch();
      const { sendPayload } = await import("../api");

      await sendPayload({
        apiUrl: "http://localhost",
        apiKey: "key",
        payload: makePayload(),
        signingKeyDir: dir,
      });

      const headers = captured!.init.headers as Record<string, string>;
      const publicKeyHeader = headers["X-Kagami-Public-Key"];
      expect(publicKeyHeader).toBeDefined();
      const decoded = Buffer.from(publicKeyHeader, "base64").toString();
      expect(decoded).toContain("BEGIN PUBLIC KEY");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("T-002: omits X-Kagami-Public-Key header when signingKeyDir not provided", async () => {
    stubFetch();
    const { sendPayload } = await import("../api");

    await sendPayload({
      apiUrl: "http://localhost",
      apiKey: "key",
      payload: makePayload(),
    });

    const headers = captured!.init.headers as Record<string, string>;
    expect(headers["X-Kagami-Public-Key"]).toBeUndefined();
  });

  test("omits Authorization header when apiKey is undefined", async () => {
    stubFetch();
    const { sendPayload } = await import("../api");

    await sendPayload({
      apiUrl: "http://localhost",
      payload: makePayload(),
    });

    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  test("passes AbortSignal when timeoutMs is provided", async () => {
    stubFetch();
    const { sendPayload } = await import("../api");

    await sendPayload({
      apiUrl: "http://localhost",
      payload: makePayload(),
      timeoutMs: 5000,
    });

    expect(captured).not.toBeNull();
    expect(captured!.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("does not pass AbortSignal when timeoutMs is omitted", async () => {
    stubFetch();
    const { sendPayload } = await import("../api");

    await sendPayload({
      apiUrl: "http://localhost",
      payload: makePayload(),
    });

    expect(captured).not.toBeNull();
    expect(captured!.init.signal).toBeUndefined();
  });

  test("propagates fetch rejection on network error", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("network failure"))) as unknown as typeof fetch;
    const { sendPayload } = await import("../api");

    await expect(
      sendPayload({
        apiUrl: "http://localhost",
        payload: makePayload(),
      }),
    ).rejects.toThrow("network failure");
  });

  test("returns non-OK response without throwing", async () => {
    stubFetch(500);
    const { sendPayload } = await import("../api");

    const res = await sendPayload({
      apiUrl: "http://localhost",
      payload: makePayload(),
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });
});

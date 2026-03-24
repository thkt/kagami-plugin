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

function stubFetch() {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

describe("sendPayload", () => {
  test("adds X-Kagami-Signature header when signingKeyDir provided", async () => {
    const dir = makeTmpDir();
    try {
      stubFetch();
      const { sendPayload } = await import("../api");
      const payload = makePayload();

      await sendPayload("http://localhost", "key", payload, undefined, dir);

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

      await sendPayload("http://localhost", "key", payload, undefined, dir);

      const body = captured!.init.body as string;
      const headers = captured!.init.headers as Record<string, string>;
      const signature = headers["X-Kagami-Signature"];
      const { publicKey } = ensureKeyPair(dir);

      expect(verifyPayload(body, signature, publicKey)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("still sends when signingKeyDir is omitted (backward compat)", async () => {
    stubFetch();
    const { sendPayload } = await import("../api");
    const payload = makePayload();

    await sendPayload("http://localhost", "key", payload);

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("http://localhost/api/events");
  });

  test("preserves Authorization header", async () => {
    const dir = makeTmpDir();
    try {
      stubFetch();
      const { sendPayload } = await import("../api");

      await sendPayload("http://localhost", "my-key", makePayload(), undefined, dir);

      const headers = captured!.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer my-key");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("sends without signature when signing fails (graceful degradation)", async () => {
    stubFetch();
    const { sendPayload } = await import("../api");
    const payload = makePayload();

    await sendPayload("http://localhost", "key", payload, undefined, "/dev/null/impossible");

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

      await sendPayload("http://localhost", "key", makePayload(), undefined, dir);

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

    await sendPayload("http://localhost", "key", makePayload());

    const headers = captured!.init.headers as Record<string, string>;
    expect(headers["X-Kagami-Public-Key"]).toBeUndefined();
  });

  test("omits Authorization header when apiKey is undefined", async () => {
    stubFetch();
    const { sendPayload } = await import("../api");

    await sendPayload("http://localhost", undefined, makePayload());

    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

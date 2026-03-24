import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureKeyPair,
  signPayload,
  verifyPayload,
} from "../signing";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "kagami-signing-"));
}

describe("ensureKeyPair", () => {
  test("generates key files on first call", () => {
    const dir = makeTmpDir();
    try {
      const { publicKey, privateKey } = ensureKeyPair(dir);
      expect(publicKey).toContain("PUBLIC KEY");
      expect(privateKey).toContain("PRIVATE KEY");

      const pubOnDisk = readFileSync(join(dir, "signing_pub.pem"), "utf8");
      const privOnDisk = readFileSync(join(dir, "signing_key.pem"), "utf8");
      expect(pubOnDisk).toBe(publicKey);
      expect(privOnDisk).toBe(privateKey);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("returns existing keys on second call", () => {
    const dir = makeTmpDir();
    try {
      const first = ensureKeyPair(dir);
      const second = ensureKeyPair(dir);
      expect(second.publicKey).toBe(first.publicKey);
      expect(second.privateKey).toBe(first.privateKey);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("regenerates both keys when only private key exists", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, "signing_key.pem"), "stale-private-key");
      const { publicKey, privateKey } = ensureKeyPair(dir);
      expect(publicKey).toContain("PUBLIC KEY");
      expect(privateKey).toContain("PRIVATE KEY");
      // verify the new pair works together
      const sig = signPayload("{}", privateKey);
      expect(verifyPayload("{}", sig, publicKey)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("regenerates both keys when only public key exists", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, "signing_pub.pem"), "stale-public-key");
      const { publicKey, privateKey } = ensureKeyPair(dir);
      expect(publicKey).toContain("PUBLIC KEY");
      expect(privateKey).toContain("PRIVATE KEY");
      const sig = signPayload("{}", privateKey);
      expect(verifyPayload("{}", sig, publicKey)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("signPayload / verifyPayload", () => {
  test("sign then verify round-trip succeeds", () => {
    const dir = makeTmpDir();
    try {
      const { publicKey, privateKey } = ensureKeyPair(dir);
      const body = JSON.stringify({ hello: "world" });

      const signature = signPayload(body, privateKey);
      expect(verifyPayload(body, signature, publicKey)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("verification fails with tampered body", () => {
    const dir = makeTmpDir();
    try {
      const { publicKey, privateKey } = ensureKeyPair(dir);
      const body = JSON.stringify({ hello: "world" });
      const signature = signPayload(body, privateKey);

      const tampered = JSON.stringify({ hello: "tampered" });
      expect(verifyPayload(tampered, signature, publicKey)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("verification fails with wrong key", () => {
    const dir1 = makeTmpDir();
    const dir2 = makeTmpDir();
    try {
      const keys1 = ensureKeyPair(dir1);
      const keys2 = ensureKeyPair(dir2);
      const body = JSON.stringify({ data: 42 });
      const signature = signPayload(body, keys1.privateKey);

      expect(verifyPayload(body, signature, keys2.publicKey)).toBe(false);
    } finally {
      rmSync(dir1, { recursive: true });
      rmSync(dir2, { recursive: true });
    }
  });

  test("signature is base64 encoded", () => {
    const dir = makeTmpDir();
    try {
      const { privateKey } = ensureKeyPair(dir);
      const signature = signPayload("{}", privateKey);
      const decoded = Buffer.from(signature, "base64");
      expect(decoded.length).toBe(64); // ed25519 signature = 64 bytes
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("signPayload throws on invalid PEM", () => {
    expect(() => signPayload("{}", "not-a-pem")).toThrow();
  });

  test("verifyPayload throws on invalid PEM", () => {
    expect(() => verifyPayload("{}", "c2ln", "not-a-pem")).toThrow();
  });
});

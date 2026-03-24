import {
  generateKeyPairSync,
  sign,
  verify,
  createPublicKey,
  createPrivateKey,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SIGNING_KEY_DIR = join(homedir(), ".claude", "plugins", "kagami");

const PRIV_FILE = "signing_key.pem";
const PUB_FILE = "signing_pub.pem";

export function ensureKeyPair(dir: string): {
  publicKey: string;
  privateKey: string;
} {
  const privPath = join(dir, PRIV_FILE);
  const pubPath = join(dir, PUB_FILE);

  if (existsSync(privPath) && existsSync(pubPath)) {
    return {
      privateKey: readFileSync(privPath, "utf8"),
      publicKey: readFileSync(pubPath, "utf8"),
    };
  }

  mkdirSync(dir, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  writeFileSync(privPath, privateKey, { mode: 0o600 });
  writeFileSync(pubPath, publicKey);

  return { publicKey, privateKey };
}

export function signPayload(body: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const sig = sign(null, Buffer.from(body), key);
  return sig.toString("base64");
}

export function verifyPayload(
  body: string,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  const key = createPublicKey(publicKeyPem);
  const sig = Buffer.from(signatureBase64, "base64");
  return verify(null, Buffer.from(body), key, sig);
}

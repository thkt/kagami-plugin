import type { EventPayload } from "./types";
import { ensureKeyPair, signPayload } from "./signing";

export interface SendOptions {
  apiUrl: string;
  apiKey?: string;
  payload: EventPayload;
  timeoutMs?: number;
  signingKeyDir?: string;
}

export function sendPayload(options: SendOptions): Promise<Response> {
  const { apiUrl, apiKey, payload, timeoutMs, signingKeyDir } = options;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (signingKeyDir) {
    try {
      const { publicKey, privateKey } = ensureKeyPair(signingKeyDir);
      headers["X-Kagami-Signature"] = signPayload(body, privateKey);
      headers["X-Kagami-Public-Key"] = Buffer.from(publicKey).toString("base64");
    } catch {
      // signing failure must not block sending
    }
  }

  return fetch(`${apiUrl}/api/events`, {
    method: "POST",
    headers,
    body,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
}

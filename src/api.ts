import type { EventPayload } from "./types";

export function sendPayload(
  apiUrl: string,
  apiKey: string | undefined,
  payload: EventPayload,
  timeoutMs?: number,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  return fetch(`${apiUrl}/api/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
}

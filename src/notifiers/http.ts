import { USER_AGENT } from "../shared/version.ts";

const TIMEOUT_MS = 15_000;

/** Sends `body` as JSON; throws an error with the status and the start of the response on failure. */
export async function sendJson(
  url: string,
  body: unknown,
  { method = "POST", headers = {} }: { method?: string; headers?: Record<string, string> } = {},
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "user-agent": USER_AGENT, ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error((err as Error).name === "TimeoutError" ? `timeout after ${TIMEOUT_MS / 1000}s` : (err as Error).message);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
}

/** Hides most of a secret, for summaries and logs: "••••a1b2". */
export function mask(secret: string): string {
  return `••••${secret.slice(-4)}`;
}

export const withTrailingSlash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

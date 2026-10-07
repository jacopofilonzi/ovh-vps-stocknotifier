import type { z } from "zod";
import { USER_AGENT } from "./version.ts";

/**
 * - `transient`: network error, timeout, 429, 5xx, non-JSON body (e.g. a maintenance page). Retry later.
 * - `request`: any other 4xx. Retrying the same request won't help.
 * - `incompatible`: valid JSON that no longer matches the data this version relies on.
 */
export type ApiErrorKind = "transient" | "request" | "incompatible";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** Stable description of the problem, used to recognise the same error across attempts. */
  readonly signature: string;
  readonly status: number | undefined;

  constructor(kind: ApiErrorKind, signature: string, status?: number) {
    super(signature);
    this.name = "ApiError";
    this.kind = kind;
    this.signature = signature;
    this.status = status;
  }
}

export async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const source = new URL(url).pathname;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = (err as Error).name === "TimeoutError" ? `timeout after ${timeoutMs / 1000}s` : (err as Error).message;
    throw new ApiError("transient", `${source}: ${reason}`);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const kind = res.status === 429 || res.status >= 500 ? "transient" : "request";
    throw new ApiError(kind, `${source}: HTTP ${res.status} ${extractMessage(text)}`.trim(), res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("transient", `${source}: response is not JSON`, res.status);
  }
}

/** OVH errors look like `{"class":"Client::NotFound","message":"..."}`. */
function extractMessage(body: string): string {
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  } catch {
    return "";
  }
}

/** Parses `data` with `schema`, turning a mismatch into an `incompatible` ApiError. */
export function parseOrIncompatible<T>(schema: z.ZodType<T>, data: unknown, source: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new ApiError("incompatible", `${source}: ${describeIssue(result.error)}`);
}

export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid data";
  const where = issue.path.length ? issue.path.join(".") : "(root)";
  return `${where}: ${issue.message}`;
}

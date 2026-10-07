import { unwatchFile, watchFile } from "node:fs";
import { CONFIG_PATH } from "../shared/paths.ts";
import type { State } from "../state/schema.ts";
import { isConfirming } from "./health.ts";

const MINUTE = 60_000;
/** Ceiling of the backoff after failed ticks. */
export const MAX_BACKOFF_MS = 30 * MINUTE;
/** Minimum spacing between the attempts that confirm an incompatible response. */
export const CONFIRMATION_SPACING_MS = 10 * MINUTE;
/** How often config.json is checked for changes while waiting. */
const CONFIG_POLL_MS = 2_000;

/** Delay before the next tick, with ±10% jitter so requests don't always hit the same second. */
export function nextDelayMs(intervalSeconds: number, health: State["health"], random = Math.random): number {
  const base = intervalSeconds * 1000;
  let delay = base;
  if (isConfirming(health)) {
    // 2nd attempt after max(interval, 10 min), 3rd after twice that.
    delay = Math.max(base, CONFIRMATION_SPACING_MS) * 2 ** (health.attempts - 1);
  } else if (health.failures > 0) {
    delay = Math.max(base, Math.min(base * 2 ** health.failures, MAX_BACKOFF_MS));
  }
  return Math.round(delay * (0.9 + random() * 0.2));
}

export type WakeReason = "timeout" | "config" | "abort";

/**
 * Waits until `ms` elapse (forever if omitted), config.json changes, or `signal` aborts,
 * whichever comes first. Changes are detected by polling the file's modification time:
 * filesystem events aren't delivered reliably on Docker Desktop bind mounts.
 */
export function waitFor({ ms, signal }: { ms?: number; signal: AbortSignal }): Promise<WakeReason> {
  if (signal.aborted) return Promise.resolve("abort");
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const onAbort = () => done("abort");
    const onChange = (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => {
      if (curr.mtimeMs !== prev.mtimeMs) done("config");
    };
    function done(reason: WakeReason) {
      clearTimeout(timer);
      unwatchFile(CONFIG_PATH, onChange);
      signal.removeEventListener("abort", onAbort);
      resolve(reason);
    }
    if (ms !== undefined && Number.isFinite(ms)) timer = setTimeout(() => done("timeout"), Math.max(0, ms));
    watchFile(CONFIG_PATH, { interval: CONFIG_POLL_MS }, onChange);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

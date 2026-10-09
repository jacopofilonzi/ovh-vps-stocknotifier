import { existsSync, unwatchFile, watchFile, type Stats } from "node:fs";
import { rm } from "node:fs/promises";
import { CHECK_NOW_PATH, CONFIG_PATH } from "../shared/paths.ts";
import type { State } from "../state/schema.ts";
import { isConfirming } from "./health.ts";

// When the next check runs. The scraper and the TUI only talk through files in DATA_DIR:
// config.json (written by the TUI) and check-now (created by the TUI, removed here once a check
// has served it). Both are polled: see waitFor.

const MINUTE = 60_000;
/** Ceiling of the backoff after failed ticks. */
export const MAX_BACKOFF_MS = 30 * MINUTE;
/** Minimum spacing between the attempts that confirm an incompatible response. */
export const CONFIRMATION_SPACING_MS = 10 * MINUTE;
/** How often config.json and the check-now file are checked while waiting. */
const POLL_MS = 2_000;

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

export type WakeReason = "timeout" | "config" | "check-now" | "abort";

/**
 * Waits until `ms` elapse (forever if omitted), config.json changes, a check is requested
 * (check-now file created), or `signal` aborts, whichever comes first. Changes are detected by
 * polling modification times: filesystem events aren't delivered reliably on Docker Desktop bind mounts.
 */
export function waitFor({ ms, signal }: { ms?: number; signal: AbortSignal }): Promise<WakeReason> {
  if (signal.aborted) return Promise.resolve("abort");
  // A request made while the previous check was running is served right away.
  if (existsSync(CHECK_NOW_PATH)) return Promise.resolve("check-now");
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const onAbort = () => done("abort");
    const onConfig = (curr: Stats, prev: Stats) => {
      if (curr.mtimeMs !== prev.mtimeMs) done("config");
    };
    // mtime 0 means the file doesn't exist: ignore its deletion.
    const onCheckNow = (curr: Stats) => {
      if (curr.mtimeMs !== 0) done("check-now");
    };
    function done(reason: WakeReason) {
      clearTimeout(timer);
      unwatchFile(CONFIG_PATH, onConfig);
      unwatchFile(CHECK_NOW_PATH, onCheckNow);
      signal.removeEventListener("abort", onAbort);
      resolve(reason);
    }
    if (ms !== undefined && Number.isFinite(ms)) timer = setTimeout(() => done("timeout"), Math.max(0, ms));
    watchFile(CONFIG_PATH, { interval: POLL_MS }, onConfig);
    watchFile(CHECK_NOW_PATH, { interval: POLL_MS }, onCheckNow);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Marks a check request as served. */
export async function consumeCheckRequest() {
  await rm(CHECK_NOW_PATH, { force: true });
}

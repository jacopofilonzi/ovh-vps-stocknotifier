import type { HealthEvent } from "../events.ts";
import { ApiError } from "../shared/http.ts";
import type { State } from "../state/schema.ts";

/** Attempts with the same incompatible response before halting. */
export const CONFIRMATION_ATTEMPTS = 3;
/** Consecutive failed ticks before notifying that monitoring is degraded. */
export const DEGRADED_AFTER_FAILURES = 3;

type Health = State["health"];

/**
 * Updates `health` after a tick and returns the event to notify, if any.
 * `error` is the tick's error, or null if it fully succeeded.
 */
export function updateHealth(health: Health, error: Error | null, now: Date, appVersion: string): HealthEvent | null {
  const nowIso = now.toISOString();

  if (!error) {
    const event: HealthEvent | null =
      health.status !== "ok" && health.notified
        ? { kind: "health", status: "recovered", detail: "OVH APIs are responding as expected again" }
        : null;
    Object.assign(health, { status: "ok", failures: 0, attempts: 0, notified: false });
    if (event) health.since = nowIso;
    delete health.lastError;
    delete health.signature;
    delete health.haltedVersion;
    return event;
  }

  const signature = error instanceof ApiError ? error.signature : error.message;
  health.lastError = signature;
  health.failures++;

  if (error instanceof ApiError && error.kind === "incompatible") {
    if (health.status === "halted" && health.signature === signature && health.haltedVersion === appVersion) {
      // Same problem after a restart or a config change: already notified.
      return null;
    }
    health.attempts = health.signature === signature ? health.attempts + 1 : 1;
    health.signature = signature;
    if (health.attempts < CONFIRMATION_ATTEMPTS) return null;
    Object.assign(health, { status: "halted", since: nowIso, haltedVersion: appVersion, notified: true });
    return { kind: "health", status: "halted", detail: signature };
  }

  const requestError = error instanceof ApiError && error.kind === "request";
  if (health.status === "ok" && (requestError || health.failures >= DEGRADED_AFTER_FAILURES)) {
    Object.assign(health, { status: "degraded", since: nowIso, notified: true });
    return { kind: "health", status: "degraded", detail: signature };
  }
  return null;
}

/** An incompatible response is being confirmed: the next attempts are spaced out. */
export function isConfirming(health: Health): boolean {
  return health.status !== "halted" && health.signature !== undefined && health.attempts > 0;
}

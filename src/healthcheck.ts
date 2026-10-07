import { peekState } from "./state/store.ts";

const MINUTE = 60_000;
/** The scraper writes a heartbeat every minute, even while waiting. */
const HEARTBEAT_MAX_AGE_MS = 3 * MINUTE;

/**
 * Docker healthcheck: exits 0 when the scraper is alive and working, 1 otherwise.
 * Waiting for a configuration is healthy; being halted or failing for too long is not.
 */
export async function runHealthcheck(): Promise<number> {
  const state = await peekState();
  const problem = (() => {
    if (!state) return "no readable state.json";
    const now = Date.now();
    if (now - Date.parse(state.heartbeat) > HEARTBEAT_MAX_AGE_MS) return "heartbeat is stale";
    if (state.phase === "halted") return `halted: ${state.health.signature}`;
    if (state.phase === "running") {
      const maxAge = Math.max(60 * MINUTE, 6 * (state.intervalSeconds ?? 300) * 1000);
      const lastSuccess = Date.parse(state.lastSuccess ?? state.health.since);
      if (now - lastSuccess > maxAge) return `no successful check since ${state.lastSuccess ?? "start"}`;
    }
    return null;
  })();
  if (problem) console.error(`unhealthy: ${problem}`);
  return problem ? 1 : 0;
}

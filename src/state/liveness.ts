import { formatTime } from "../shared/time.ts";
import { HEARTBEAT_STALE_MS, type State } from "./schema.ts";

/**
 * What the scraper is doing, judged from state.json. A crashed process can't report it,
 * so a stale heartbeat (without a clean "stopped") is the only sign: "dead".
 */
export type Liveness = "running" | "waiting-config" | "halted" | "stopped" | "dead" | "never-started";

export function liveness(state: State | null, now = Date.now()): Liveness {
  if (!state) return "never-started";
  if (state.phase === "stopped") return "stopped";
  if (now - Date.parse(state.heartbeat) > HEARTBEAT_STALE_MS) return "dead";
  return state.phase;
}

export function describeLiveness(state: State | null): string {
  switch (liveness(state)) {
    case "never-started":
      return "the scraper hasn't run yet";
    case "stopped":
      return `the scraper was stopped at ${formatTime(state!.heartbeat)}`;
    case "dead":
      return `the scraper isn't responding since ${formatTime(state!.heartbeat)} (crashed or killed?)`;
    case "waiting-config":
      return "the scraper is waiting for a usable configuration";
    case "halted":
      return `the scraper is halted: ${state!.health.signature}`;
    case "running":
      return "the scraper is running";
  }
}

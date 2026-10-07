import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CHECK_NOW_PATH } from "./shared/paths.ts";
import { formatTime } from "./shared/time.ts";
import { describeLiveness, liveness } from "./state/liveness.ts";
import type { State } from "./state/schema.ts";
import { peekState } from "./state/store.ts";
import { statusLines } from "./status.ts";

/** A check younger than this is shown as is instead of asking for a new one. */
const RECENT_CHECK_MS = 30_000;
/** A check takes up to ~30s when OVH is slow (catalog timeout), plus the 2s polling of the request. */
const WAIT_TIMEOUT_MS = 75_000;
const POLL_MS = 500;

export type CheckResult =
  | { status: "done" | "recent"; state: State }
  | { status: "timeout" }
  | { status: "unavailable"; reason: string };

/**
 * Asks the running scraper for an immediate check and waits for it. The scraper does the work,
 * so notifications are sent and state.json is updated exactly as in a scheduled check.
 */
export async function requestCheck(): Promise<CheckResult> {
  const state = await peekState();
  const live = liveness(state);
  if (live !== "running" && live !== "halted") return { status: "unavailable", reason: describeLiveness(state) };
  if (live === "running" && state!.lastCheck && Date.now() - Date.parse(state!.lastCheck) < RECENT_CHECK_MS) {
    return { status: "recent", state: state! };
  }

  await mkdir(path.dirname(CHECK_NOW_PATH), { recursive: true });
  await writeFile(CHECK_NOW_PATH, new Date().toISOString() + "\n");
  // The scraper deletes the request after saving the state of the check that served it.
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (existsSync(CHECK_NOW_PATH)) {
    if (Date.now() > deadline) return { status: "timeout" };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const after = await peekState();
  return after ? { status: "done", state: after } : { status: "timeout" };
}

/** Lines describing a check result: the events of the check, then the status table. */
export async function checkResultLines(result: CheckResult): Promise<string[]> {
  switch (result.status) {
    case "unavailable":
      return [`Can't check now: ${result.reason}.`];
    case "timeout":
      return [
        "The scraper hasn't answered yet: the request stays queued and will be served by its next check.",
        "Look at Status in a minute.",
      ];
    case "recent":
    case "done": {
      const events = result.state.lastEvents ?? [];
      const header =
        result.status === "recent"
          ? [`Last check was less than ${RECENT_CHECK_MS / 1000}s ago (${formatTime(result.state.lastCheck)}): showing it.`]
          : [events.length ? "Check done, notified:" : "Check done: no changes."];
      return [...header, ...(result.status === "done" ? events.map((e) => `  ${e}`) : []), "", ...(await statusLines())];
    }
  }
}

/** `node src/main.ts check-now`: exits 0 when the check ran (or ran moments ago). */
export async function runCheckNow(): Promise<number> {
  console.log("Asking the scraper for a check…");
  const result = await requestCheck();
  console.log((await checkResultLines(result)).join("\n"));
  return result.status === "done" || result.status === "recent" ? 0 : 1;
}

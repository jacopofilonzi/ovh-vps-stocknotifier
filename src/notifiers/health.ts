import type { Config } from "../config/schema.ts";
import type { NotifierHealthEvent } from "../events.ts";
import type { State } from "../state/schema.ts";
import type { DispatchResult } from "./index.ts";

/**
 * Tracks failing notifiers after a dispatch. Returns the events to report on the notifiers that
 * work: a failure is reported once per incident, a recovery only if the failure was reported.
 */
export function updateNotifierHealth(
  state: State,
  config: Config,
  result: DispatchResult,
  now: Date,
): NotifierHealthEvent[] {
  const events: NotifierHealthEvent[] = [];
  const failing = state.failingNotifiers;

  for (const id of Object.keys(failing)) {
    if (!config.notifiers.some((n) => n.id === id && n.enabled)) delete failing[id];
  }
  for (const { id, error } of result.failures) {
    failing[id] = { since: failing[id]?.since ?? now.toISOString(), error, reported: failing[id]?.reported ?? false };
  }
  for (const id of result.delivered) {
    if (failing[id]?.reported) events.push({ kind: "notifier", id, name: nameOf(config, id), failing: false });
    delete failing[id];
  }
  for (const [id, entry] of Object.entries(failing)) {
    if (!entry.reported) events.push({ kind: "notifier", id, name: nameOf(config, id), failing: true, error: entry.error });
  }
  return events;
}

/** Marks the failures in `events` as reported. */
export function markReported(state: State, events: readonly NotifierHealthEvent[]) {
  for (const event of events) {
    const entry = state.failingNotifiers[event.id];
    if (event.failing && entry) entry.reported = true;
  }
}

function nameOf(config: Config, id: string): string {
  return config.notifiers.find((n) => n.id === id)?.name ?? id;
}

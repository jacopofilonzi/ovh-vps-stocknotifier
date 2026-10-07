import { rename } from "node:fs/promises";
import { describeIssue } from "../shared/http.ts";
import { readJsonFile, writeJsonFile } from "../shared/json-file.ts";
import { STATE_PATH } from "../shared/paths.ts";
import { APP_VERSION } from "../shared/version.ts";
import { STATE_SCHEMA_VERSION, freshState, stateSchema, type State } from "./schema.ts";

export type StateLoadResult = {
  state: State;
  /** Set when a corrupted state.json was moved aside: path of the backup and the reason. */
  corrupted?: { backup: string; reason: string };
  /** Set when state.json had another stateSchemaVersion and was discarded. */
  discarded?: boolean;
};

export async function loadState(now = new Date()): Promise<StateLoadResult> {
  const file = await readJsonFile(STATE_PATH);
  if (file.status === "missing") return { state: freshState(APP_VERSION, now) };
  if (file.status === "unparsable") return moveAside(`not valid JSON: ${file.error}`, now);

  const version = (file.data as { stateSchemaVersion?: unknown } | null)?.stateSchemaVersion;
  if (version !== STATE_SCHEMA_VERSION) return { state: freshState(APP_VERSION, now), discarded: true };

  const parsed = stateSchema.safeParse(file.data);
  if (!parsed.success) return moveAside(describeIssue(parsed.error), now);
  return { state: { ...parsed.data, appVersion: APP_VERSION } };
}

async function moveAside(reason: string, now: Date): Promise<StateLoadResult> {
  const backup = `${STATE_PATH}.corrupt-${now.toISOString().replace(/[:.]/g, "-")}`;
  await rename(STATE_PATH, backup);
  return { state: freshState(APP_VERSION, now), corrupted: { backup, reason } };
}

/** Read-only load for the TUI, the status command and the healthcheck: never moves files. */
export async function peekState(): Promise<State | null> {
  const file = await readJsonFile(STATE_PATH);
  if (file.status !== "ok") return null;
  const parsed = stateSchema.safeParse(file.data);
  return parsed.success ? parsed.data : null;
}

/** Saves are queued, so the heartbeat timer and the tick never write at the same time. */
let queue: Promise<void> = Promise.resolve();

export function saveState(state: State): Promise<void> {
  const snapshot = structuredClone(state);
  const write = queue.catch(() => {}).then(() => writeJsonFile(STATE_PATH, snapshot));
  queue = write;
  return write;
}

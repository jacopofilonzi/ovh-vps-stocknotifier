import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, LOG_LEVELS } from "../config/env.ts";
import type { Config } from "../config/schema.ts";
import { loadConfig } from "../config/store.ts";
import type { AppEvent } from "../events.ts";
import { describeEvent, eventEmoji } from "../notifiers/format.ts";
import { markReported, updateNotifierHealth } from "../notifiers/health.ts";
import { dispatch } from "../notifiers/index.ts";
import type { Catalog } from "../ovh/catalog.ts";
import { getSubsidiary } from "../ovh/subsidiaries.ts";
import { log, logOnce, resetLogOnce } from "../shared/log.ts";
import { DATA_DIR } from "../shared/paths.ts";
import { APP_NAME, APP_VERSION, REPO_URL } from "../shared/version.ts";
import { HEARTBEAT_INTERVAL_MS, type State } from "../state/schema.ts";
import { loadState, saveState } from "../state/store.ts";
import { updateHealth } from "./health.ts";
import { consumeCheckRequest, nextDelayMs, waitFor } from "./schedule.ts";
import { isIncompatible, runTick } from "./tick.ts";

// The scraper process: the only one that checks OVH for real, notifies and writes state.json.
// It never exits on its own. Without a usable config.json it waits for one ("waiting-config");
// when halted it stays up (so Docker doesn't restart it in a loop) and makes one attempt at
// startup, on a config change or on a check request. The heartbeat in state.json tells the TUI
// and the healthcheck it's alive; "stopped" is written on a clean shutdown.
// Each check works on a copy of the state: an incompatible response discards the copy, and if no
// notifier delivers, plans and stock are rolled back so the same changes are notified next time.

const TUI_HINT = "run the TUI to configure it (docker compose run --rm notifier tui, or make tui)";

type Usable = { config: Config } | { config?: undefined; level: "info" | "warn" | "error"; reason: string };

export async function runScraper({ once = false } = {}): Promise<number> {
  if (!(await isDataDirWritable())) return 1;

  const controller = new AbortController();
  const stop = (signal: string) => {
    if (controller.signal.aborted) return;
    log.info(`${signal} received, stopping`);
    controller.abort();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  const loaded = await loadState();
  let state = loaded.state;
  /** Events waiting for a usable config to be notified. */
  const pending: AppEvent[] = [];
  if (loaded.corrupted) {
    log.warn(`state.json was corrupted (${loaded.corrupted.reason}): moved to ${loaded.corrupted.backup}, starting fresh`);
    pending.push({ kind: "health", status: "state-reset", detail: `backup saved as ${path.basename(loaded.corrupted.backup)}` });
  }
  if (loaded.discarded) log.info("state.json was written by an incompatible version: starting fresh");
  if (state.health.status === "halted" && state.health.haltedVersion !== APP_VERSION) {
    log.info(`halted by version ${state.health.haltedVersion}, now running ${APP_VERSION}: resuming`);
    state.health = { status: "ok", since: new Date().toISOString(), failures: 0, attempts: 0, notified: false };
  }

  log.info(`${APP_NAME} ${APP_VERSION} started, data in ${DATA_DIR}`);
  if (env.invalidLogLevel !== undefined) {
    log.warn(`unknown LOG_LEVEL "${env.invalidLogLevel}": using info (valid: ${LOG_LEVELS.join(", ")})`);
  }
  const heartbeat = setInterval(() => {
    state.heartbeat = new Date().toISOString();
    saveState(state).catch((err) => log.error(`saving state failed: ${err.message}`));
  }, HEARTBEAT_INTERVAL_MS);

  let catalog: Catalog | null = null;
  let lastGood: Config | null = null;
  // A halted scraper still makes one attempt at startup and after each config change.
  let retryHalted = true;

  try {
    while (!controller.signal.aborted) {
      const usable = await usableConfig(lastGood);
      if (!usable.config) {
        logOnce("config", usable.level, `${usable.reason}: waiting for configuration, ${TUI_HINT}`);
        state.phase = "waiting-config";
        await saveState(state);
        if (once) return 1;
        if ((await waitFor({ signal: controller.signal })) === "check-now") {
          log.info("check requested, but there is no usable configuration yet");
          await consumeCheckRequest();
        }
        continue;
      }
      const config = usable.config;
      if (lastGood === null) log.info(`configuration loaded: ${describeConfig(config)}`);
      resetLogOnce("config");
      lastGood = config;
      if (!config.notifiers.some((n) => n.enabled)) {
        logOnce("notifiers", "warn", "no notifier enabled: changes are recorded but not notified");
      } else {
        resetLogOnce("notifiers");
      }

      if (state.health.status === "halted" && !retryHalted) {
        state.phase = "halted";
        await saveState(state);
        if (once) return 1;
        const reason = await waitFor({ signal: controller.signal });
        retryHalted = reason === "config" || reason === "check-now";
        continue;
      }
      retryHalted = false;

      state = await check(config, state, catalog, pending, (c) => (catalog = c));
      if (once) return state.health.status === "ok" && !state.health.lastError ? 0 : 1;

      const tickEnd = Date.now();
      if (state.health.status === "halted") continue;
      // Wait for the next tick. A config change reschedules it from the end of this tick;
      // a check request (from the TUI) runs it right away, skipping any backoff.
      while (true) {
        const interval = (await usableConfig(lastGood)).config?.intervalSeconds ?? config.intervalSeconds;
        const delay = tickEnd + nextDelayMs(interval, state.health) - Date.now();
        log.debug(`next check in ${Math.round(delay / 1000)}s`);
        const reason = await waitFor({ ms: delay, signal: controller.signal });
        if (reason === "check-now") log.info("check requested");
        if (reason !== "config") break;
      }
    }
  } finally {
    clearInterval(heartbeat);
    state.phase = "stopped";
    state.heartbeat = new Date().toISOString();
    await saveState(state);
  }
  return 0;
}

/** Runs one tick and returns the new state. */
async function check(
  config: Config,
  previous: State,
  cached: Catalog | null,
  pending: AppEvent[],
  setCatalog: (catalog: Catalog | null) => void,
): Promise<State> {
  const now = new Date();
  const started = Date.now();
  const working = structuredClone(previous);
  const outcome = await runTick(config, working, cached, now);
  setCatalog(outcome.catalog);

  // An incompatible response may have half-updated the working copy: keep the previous state.
  const state = isIncompatible(outcome.error) ? structuredClone(previous) : working;
  const events = [...pending.splice(0), ...(isIncompatible(outcome.error) ? [] : outcome.events)];

  const healthEvent = updateHealth(state.health, outcome.error, now, APP_VERSION);
  if (healthEvent) events.unshift(healthEvent);
  if (!outcome.error) state.lastSuccess = now.toISOString();
  state.phase = state.health.status === "halted" ? "halted" : "running";
  state.heartbeat = now.toISOString();

  if (state.health.status === "halted" && healthEvent) {
    log.error(
      `OVH changed the data this version relies on: ${state.health.signature}. ` +
        `Monitoring is paused: wait for a new version and check ${REPO_URL} (running ${APP_VERSION})`,
    );
  } else if (outcome.error && !isIncompatible(outcome.error)) {
    log.warn(`check failed: ${outcome.error.message}`);
  } else if (isIncompatible(outcome.error)) {
    log.warn(`incompatible response (attempt ${state.health.attempts}): ${outcome.error!.message}`);
  }

  if (events.length > 0) {
    const base = { subsidiary: config.subsidiary, orderUrl: getSubsidiary(config.subsidiary).orderUrl };
    const result = await dispatch(config, { ...base, events });
    if (result.attempted > 0 && result.delivered.length === 0) {
      // Nobody got the news: keep the old plans and stock so the same changes are notified next tick.
      log.warn("no notifier could deliver the changes: they'll be retried on the next check");
      state.plans = previous.plans;
      state.stock = previous.stock;
    }
    const notifierEvents = updateNotifierHealth(state, config, result, now);
    if (notifierEvents.length > 0 && result.delivered.length > 0) {
      const report = await dispatch(config, { ...base, events: notifierEvents }, new Set(result.delivered));
      if (report.delivered.length > 0) markReported(state, notifierEvents);
    }
  }

  state.lastEvents = events.map((e) => `${eventEmoji(e)} ${describeEvent(e)}`);
  await saveState(state);
  // Any pending check request is served by this check (saved first: the TUI reads it once the request is gone).
  await consumeCheckRequest();
  const changes = events.length ? `${events.length} event(s)` : "no changes";
  log.info(
    `checked ${config.plans.length} plan(s) × ${config.datacenters.length} datacenter(s) × ${config.os.join("+")}: ` +
      `${changes}, ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  return state;
}

async function usableConfig(lastGood: Config | null): Promise<Usable> {
  const result = await loadConfig();
  switch (result.status) {
    case "missing":
      return { level: "info", reason: "config.json not found" };
    case "newer":
      return {
        level: "error",
        reason: `config.json was written by a newer version (configSchemaVersion ${result.version}), update this one`,
      };
    case "invalid":
      if (lastGood) {
        logOnce("invalid-config", "warn", `config.json is invalid (${result.error}): still using the previous configuration`);
        return { config: lastGood };
      }
      return { level: "error", reason: `config.json is invalid (${result.error})` };
    case "ok":
      resetLogOnce("invalid-config");
      if (result.config.plans.length === 0) return { level: "info", reason: "no plan configured" };
      if (result.config.datacenters.length === 0) return { level: "info", reason: "no datacenter configured" };
      return { config: result.config };
  }
}

function describeConfig(config: Config): string {
  return (
    `${config.subsidiary}, ${config.plans.length} plan(s), ${config.datacenters.join("/")}, ` +
    `${config.os.join("+")}, every ${config.intervalSeconds}s`
  );
}

async function isDataDirWritable(): Promise<boolean> {
  const probe = path.join(DATA_DIR, `.write-test-${process.pid}`);
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(probe, "");
    await unlink(probe);
    return true;
  } catch (err) {
    log.error(
      `${DATA_DIR} is not writable (${(err as NodeJS.ErrnoException).code}). ` +
        `With Docker on Linux, give it to the container user: sudo chown 1000:1000 ./data`,
    );
    return false;
  }
}

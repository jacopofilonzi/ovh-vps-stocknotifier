import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { defaultConfig, type Config } from "../config/schema.ts";
import type { AppEvent } from "../events.ts";
import { parseCatalog } from "../ovh/catalog.ts";
import { freshState, stockKey, type State } from "../state/schema.ts";
import { isIncompatible, runTick } from "./tick.ts";

// Real catalog snapshot (IT subsidiary), passed as a fresh cache so it's never fetched.
const dataset = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../scripts/dataset.json"), "utf8"));
const catalog = parseCatalog(dataset, "IT");
const now = catalog.fetchedAt;

const ORDERABLE_1 = "vps-2027-model1";
const ORDERABLE_2 = "vps-2027-model2";
const WITHDRAWN = "s1-2";
const MIL = "EU-SOUTH-MIL";
const GRA = "GRA";

type StockAnswer = { datacenter: string; linuxStatus: string; windowsStatus: string }[] | Error;

/** Stock API answers by plan code; plans without an answer fail the test. */
let answers: Record<string, StockAnswer> = {};
let requested: string[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  assert.equal(url.pathname, "/1.0/vps/order/rule/datacenter", `unexpected request: ${url}`);
  const planCode = url.searchParams.get("planCode")!;
  requested.push(planCode);
  const answer = answers[planCode];
  if (!answer) throw new Error(`no stock answer for ${planCode}`);
  if (answer instanceof Error) throw answer;
  return new Response(JSON.stringify({ datacenters: answer }), { status: 200 });
};
after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  answers = {};
  requested = [];
});

const dc = (datacenter: string, linuxStatus: string, windowsStatus = "out-of-stock") => ({ datacenter, linuxStatus, windowsStatus });

function config(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig(), plans: [ORDERABLE_1, ORDERABLE_2], datacenters: [MIL, GRA], os: ["linux"], ...overrides };
}

function tick(cfg: Config, state: State) {
  return runTick(cfg, state, catalog, now);
}

const describeStock = (events: AppEvent[]) =>
  events.flatMap((e) => (e.kind === "stock" ? [`${e.plan.planCode}@${e.datacenter.code}#${e.os} ${e.status}`] : []));

describe("runTick", () => {
  it("records the first stock silently, except what is already available", async () => {
    answers[ORDERABLE_1] = [dc(MIL, "available"), dc(GRA, "out-of-stock")];
    answers[ORDERABLE_2] = [dc(MIL, "out-of-stock"), dc(GRA, "out-of-stock")];
    const state = freshState("1.0.0", now);

    const outcome = await tick(config(), state);

    assert.equal(outcome.error, null);
    assert.deepEqual(describeStock(outcome.events), [`${ORDERABLE_1}@${MIL}#linux available`]);
    assert.equal(state.stock[stockKey(ORDERABLE_2, GRA, "linux")]?.status, "out-of-stock");
    assert.equal(state.plans[ORDERABLE_1]?.orderable, true);
    assert.equal(state.datacenterLabels[MIL], "Milano (IT)");
    assert.equal(state.lastCheck, now.toISOString());
  });

  it("notifies changes against the stored state", async () => {
    answers[ORDERABLE_1] = [dc(MIL, "out-of-stock"), dc(GRA, "out-of-stock")];
    answers[ORDERABLE_2] = [dc(MIL, "out-of-stock"), dc(GRA, "out-of-stock")];
    const state = freshState("1.0.0", now);
    await tick(config(), state);

    answers[ORDERABLE_2] = [dc(MIL, "out-of-stock"), dc(GRA, "available")];
    const outcome = await tick(config(), state);

    assert.deepEqual(describeStock(outcome.events), [`${ORDERABLE_2}@${GRA}#linux available`]);
  });

  it("checks each OS separately", async () => {
    answers[ORDERABLE_1] = [dc(MIL, "available", "available")];
    const state = freshState("1.0.0", now);

    const outcome = await tick(config({ plans: [ORDERABLE_1], datacenters: [MIL], os: ["linux", "windows"] }), state);

    assert.deepEqual(describeStock(outcome.events), [
      `${ORDERABLE_1}@${MIL}#linux available`,
      `${ORDERABLE_1}@${MIL}#windows available`,
    ]);
  });

  it("leaves the stock of a plan untouched when its request fails", async () => {
    answers[ORDERABLE_1] = [dc(MIL, "available"), dc(GRA, "available")];
    answers[ORDERABLE_2] = [dc(MIL, "available"), dc(GRA, "available")];
    const state = freshState("1.0.0", now);
    await tick(config(), state);

    answers[ORDERABLE_1] = new TypeError("fetch failed");
    answers[ORDERABLE_2] = [dc(MIL, "out-of-stock"), dc(GRA, "available")];
    const outcome = await tick(config(), state);

    // A network error never becomes "out of stock"; the other plan is still checked.
    assert.match(outcome.error?.message ?? "", /fetch failed/);
    assert.equal(isIncompatible(outcome.error), false);
    assert.equal(state.stock[stockKey(ORDERABLE_1, MIL, "linux")]?.status, "available");
    assert.deepEqual(describeStock(outcome.events), [`${ORDERABLE_2}@${MIL}#linux out-of-stock`]);
  });

  it("leaves a datacenter missing from the stock response untouched", async () => {
    answers[ORDERABLE_1] = [dc(MIL, "available")];
    const state = freshState("1.0.0", now);
    await tick(config({ plans: [ORDERABLE_1] }), state);

    answers[ORDERABLE_1] = [dc(GRA, "out-of-stock")];
    const outcome = await tick(config({ plans: [ORDERABLE_1] }), state);

    assert.equal(outcome.error, null);
    assert.equal(state.stock[stockKey(ORDERABLE_1, MIL, "linux")]?.status, "available");
    assert.deepEqual(describeStock(outcome.events), []);
  });

  it("stops at an incompatible stock response", async () => {
    answers[ORDERABLE_1] = [dc(MIL, "something-new")];
    answers[ORDERABLE_2] = [dc(MIL, "available")];

    const outcome = await tick(config(), freshState("1.0.0", now));

    // The caller discards the state: the events of this tick are never notified.
    assert.equal(isIncompatible(outcome.error), true);
    assert.match(outcome.error!.message, /linuxStatus has unknown value "something-new"/);
    assert.deepEqual(describeStock(outcome.events), []);
  });

  it("reports an incompatible response even after a network error", async () => {
    answers[ORDERABLE_1] = new TypeError("fetch failed");
    answers[ORDERABLE_2] = [dc(MIL, "something-new")];

    const outcome = await tick(config(), freshState("1.0.0", now));

    // Otherwise the scraper would keep a half-updated state instead of discarding it.
    assert.equal(isIncompatible(outcome.error), true);
  });

  it("notifies a withdrawn plan without asking for its stock", async () => {
    answers[ORDERABLE_1] = [dc(MIL, "out-of-stock")];
    const state = freshState("1.0.0", now);

    const outcome = await tick(config({ plans: [ORDERABLE_1, WITHDRAWN], datacenters: [MIL] }), state);

    assert.deepEqual(requested, [ORDERABLE_1]);
    assert.deepEqual(
      outcome.events.map((e) => e.kind === "orderability" && `${e.plan.planCode} ${e.orderable}`),
      [`${WITHDRAWN} false`],
    );
    assert.equal(state.plans[WITHDRAWN]?.orderable, false);
  });

  it("doesn't ask for plans offered in none of the watched datacenters", async () => {
    const state = freshState("1.0.0", now);

    const outcome = await tick(config({ plans: [ORDERABLE_1], datacenters: ["EU-WEST-LZ-AMS"] }), state);

    assert.equal(outcome.error, null);
    assert.deepEqual(requested, []);
  });

  it("starts over when the subsidiary changes, and drops what is no longer watched", async () => {
    answers[ORDERABLE_1] = [dc(MIL, "out-of-stock"), dc(GRA, "out-of-stock")];
    answers[ORDERABLE_2] = [dc(MIL, "out-of-stock"), dc(GRA, "out-of-stock")];
    const state = freshState("1.0.0", now);
    state.subsidiary = "FR";
    state.plans["old-plan"] = { orderable: true, since: now.toISOString(), info: { planCode: "old-plan", invoiceName: "Old", vCore: null, ramGb: null, price: "n/a" } };
    await tick(config(), state);

    assert.equal(state.subsidiary, "IT");
    assert.equal(state.plans["old-plan"], undefined);

    await tick(config({ plans: [ORDERABLE_1], datacenters: [MIL] }), state);
    assert.deepEqual(Object.keys(state.plans), [ORDERABLE_1]);
    assert.deepEqual(Object.keys(state.stock), [stockKey(ORDERABLE_1, MIL, "linux")]);
  });
});

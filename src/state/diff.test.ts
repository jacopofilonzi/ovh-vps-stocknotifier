import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { updateOrderability, updateStock, pruneState } from "./diff.ts";
import { freshState } from "./schema.ts";

const t0 = new Date("2026-10-07T10:00:00Z");
const t1 = new Date("2026-10-07T10:05:00Z");
const plan = { planCode: "vps-1", invoiceName: "VPS-1", vCore: 2, ramGb: 4, price: "€4.49" };
const describeStock = () => ({ plan, datacenter: { code: "GRA", label: "Gravelines (FR)" }, os: "linux" as const });

describe("updateStock", () => {
  it("records a new out-of-stock key silently", () => {
    const state = freshState("1.0.0", t0);
    assert.equal(updateStock(state, "k", "out-of-stock", t0, describeStock), null);
    assert.equal(state.stock.k?.status, "out-of-stock");
  });

  it("notifies a new key that is already available", () => {
    const state = freshState("1.0.0", t0);
    assert.equal(updateStock(state, "k", "available", t0, describeStock)?.status, "available");
  });

  it("notifies changes in both directions, once", () => {
    const state = freshState("1.0.0", t0);
    updateStock(state, "k", "out-of-stock", t0, describeStock);
    assert.equal(updateStock(state, "k", "available", t1, describeStock)?.status, "available");
    assert.equal(updateStock(state, "k", "available", t1, describeStock), null);
    assert.equal(updateStock(state, "k", "out-of-stock", t1, describeStock)?.status, "out-of-stock");
  });

  it("keeps `since` while the status doesn't change", () => {
    const state = freshState("1.0.0", t0);
    updateStock(state, "k", "out-of-stock", t0, describeStock);
    updateStock(state, "k", "out-of-stock", t1, describeStock);
    assert.equal(state.stock.k?.since, t0.toISOString());
    assert.equal(state.stock.k?.lastCheck, t1.toISOString());
  });
});

describe("updateOrderability", () => {
  it("records a new orderable plan silently", () => {
    const state = freshState("1.0.0", t0);
    assert.equal(updateOrderability(state, plan, true, t0), null);
  });

  it("notifies a new plan that is already withdrawn", () => {
    const state = freshState("1.0.0", t0);
    assert.equal(updateOrderability(state, plan, false, t0)?.orderable, false);
  });

  it("notifies withdrawal and return", () => {
    const state = freshState("1.0.0", t0);
    updateOrderability(state, plan, true, t0);
    assert.equal(updateOrderability(state, plan, false, t1)?.orderable, false);
    assert.equal(updateOrderability(state, plan, false, t1), null);
    assert.equal(updateOrderability(state, plan, true, t1)?.orderable, true);
  });
});

describe("pruneState", () => {
  it("drops what is no longer monitored", () => {
    const state = freshState("1.0.0", t0);
    updateOrderability(state, plan, true, t0);
    updateOrderability(state, { ...plan, planCode: "vps-2" }, true, t0);
    updateStock(state, "a", "available", t0, describeStock);
    updateStock(state, "b", "available", t0, describeStock);
    pruneState(state, new Set(["vps-2"]), new Set(["b"]));
    assert.deepEqual(Object.keys(state.plans), ["vps-2"]);
    assert.deepEqual(Object.keys(state.stock), ["b"]);
  });
});

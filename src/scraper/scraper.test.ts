import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../shared/http.ts";
import { freshState } from "../state/schema.ts";
import { updateHealth } from "./health.ts";
import { MAX_BACKOFF_MS, nextDelayMs } from "./schedule.ts";

const now = new Date("2026-10-07T10:00:00Z");
const noJitter = () => 0.5;
const incompatible = (sig = "availability: x") => new ApiError("incompatible", sig);
const transient = () => new ApiError("transient", "timeout");

function health() {
  return freshState("1.0.0", now).health;
}

describe("updateHealth", () => {
  it("degrades after 3 transient failures and recovers once", () => {
    const h = health();
    assert.equal(updateHealth(h, transient(), now, "1.0.0"), null);
    assert.equal(updateHealth(h, transient(), now, "1.0.0"), null);
    assert.equal(updateHealth(h, transient(), now, "1.0.0")?.status, "degraded");
    assert.equal(updateHealth(h, transient(), now, "1.0.0"), null);
    assert.equal(updateHealth(h, null, now, "1.0.0")?.status, "recovered");
    assert.equal(updateHealth(h, null, now, "1.0.0"), null);
  });

  it("degrades right away on request errors", () => {
    const h = health();
    assert.equal(updateHealth(h, new ApiError("request", "HTTP 400"), now, "1.0.0")?.status, "degraded");
  });

  it("does not notify a recovery that was never notified", () => {
    const h = health();
    updateHealth(h, transient(), now, "1.0.0");
    assert.equal(updateHealth(h, null, now, "1.0.0"), null);
  });

  it("halts after 3 attempts with the same incompatible response", () => {
    const h = health();
    assert.equal(updateHealth(h, incompatible(), now, "1.0.0"), null);
    assert.equal(updateHealth(h, incompatible(), now, "1.0.0"), null);
    const event = updateHealth(h, incompatible(), now, "1.0.0");
    assert.equal(event?.status, "halted");
    assert.equal(h.haltedVersion, "1.0.0");
  });

  it("restarts the confirmation when the incompatibility changes or goes away", () => {
    const h = health();
    updateHealth(h, incompatible("a"), now, "1.0.0");
    updateHealth(h, incompatible("a"), now, "1.0.0");
    updateHealth(h, incompatible("b"), now, "1.0.0");
    assert.equal(h.attempts, 1);
    updateHealth(h, null, now, "1.0.0");
    assert.equal(h.attempts, 0);
  });

  it("stays halted without notifying again on the same problem", () => {
    const h = health();
    for (let i = 0; i < 3; i++) updateHealth(h, incompatible(), now, "1.0.0");
    assert.equal(updateHealth(h, incompatible(), now, "1.0.0"), null);
    assert.equal(h.status, "halted");
    assert.equal(updateHealth(h, null, now, "1.0.0")?.status, "recovered");
  });
});

describe("nextDelayMs", () => {
  it("uses the interval when healthy", () => {
    assert.equal(nextDelayMs(300, health(), noJitter), 300_000);
  });

  it("applies ±10% jitter", () => {
    assert.equal(nextDelayMs(300, health(), () => 0), 270_000);
    assert.equal(nextDelayMs(300, health(), () => 1), 330_000);
  });

  it("backs off exponentially after failures, up to 30 minutes", () => {
    const h = health();
    h.failures = 1;
    assert.equal(nextDelayMs(300, h, noJitter), 600_000);
    h.failures = 5;
    assert.equal(nextDelayMs(300, h, noJitter), MAX_BACKOFF_MS);
  });

  it("never waits less than the interval", () => {
    const h = health();
    h.failures = 1;
    assert.equal(nextDelayMs(3600, h, noJitter), 3_600_000);
  });

  it("spaces out the confirmation attempts", () => {
    const h = health();
    updateHealth(h, incompatible(), now, "1.0.0");
    assert.equal(nextDelayMs(300, h, noJitter), 10 * 60_000);
    updateHealth(h, incompatible(), now, "1.0.0");
    assert.equal(nextDelayMs(300, h, noJitter), 20 * 60_000);
  });
});

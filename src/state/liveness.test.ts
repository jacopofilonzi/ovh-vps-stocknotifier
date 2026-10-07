import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveness } from "./liveness.ts";
import { freshState, HEARTBEAT_STALE_MS } from "./schema.ts";

describe("liveness", () => {
  const now = Date.parse("2026-10-07T10:00:00Z");
  const state = (phase: "running" | "halted" | "stopped" | "waiting-config", heartbeatAgoMs: number) => ({
    ...freshState("1.0.0", new Date(now - heartbeatAgoMs)),
    phase,
  });

  it("is never-started without a state", () => {
    assert.equal(liveness(null, now), "never-started");
  });

  it("reports the phase while the heartbeat is fresh", () => {
    assert.equal(liveness(state("running", 10_000), now), "running");
    assert.equal(liveness(state("halted", 10_000), now), "halted");
    assert.equal(liveness(state("waiting-config", 10_000), now), "waiting-config");
  });

  it("is dead when the heartbeat is stale without a clean stop", () => {
    assert.equal(liveness(state("running", HEARTBEAT_STALE_MS + 1), now), "dead");
  });

  it("is stopped after a clean shutdown, however old", () => {
    assert.equal(liveness(state("stopped", 10 * HEARTBEAT_STALE_MS), now), "stopped");
  });
});

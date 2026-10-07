import type { StockStatus } from "../ovh/availability.ts";
import type { OrderabilityEvent, PlanInfo, StockEvent } from "../events.ts";
import type { State } from "./schema.ts";

// Rules shared by plans and stock: an event is emitted only when a known value changes.
// The first time a key is seen its value is just recorded, except for the news you'd want
// right away: a plan that's already available, or one that's already withdrawn.

export function updateOrderability(
  state: State,
  plan: PlanInfo,
  orderable: boolean,
  now: Date,
): OrderabilityEvent | null {
  const previous = state.plans[plan.planCode];
  const changed = previous ? previous.orderable !== orderable : !orderable;
  state.plans[plan.planCode] = {
    orderable,
    since: previous && previous.orderable === orderable ? previous.since : now.toISOString(),
    info: plan,
  };
  return changed ? { kind: "orderability", orderable, plan } : null;
}

export function updateStock(
  state: State,
  key: string,
  status: StockStatus,
  now: Date,
  describe: () => Omit<StockEvent, "kind" | "status">,
): StockEvent | null {
  const previous = state.stock[key];
  const changed = previous ? previous.status !== status : status === "available";
  state.stock[key] = {
    status,
    since: previous && previous.status === status ? previous.since : now.toISOString(),
    lastCheck: now.toISOString(),
  };
  return changed ? { kind: "stock", status, ...describe() } : null;
}

/** Drops plans and stock keys that are no longer monitored. */
export function pruneState(state: State, plans: ReadonlySet<string>, stockKeys: ReadonlySet<string>) {
  for (const planCode of Object.keys(state.plans)) if (!plans.has(planCode)) delete state.plans[planCode];
  for (const key of Object.keys(state.stock)) if (!stockKeys.has(key)) delete state.stock[key];
}

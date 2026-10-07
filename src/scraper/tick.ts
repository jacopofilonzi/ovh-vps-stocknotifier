import type { Config } from "../config/schema.ts";
import type { AppEvent, PlanInfo } from "../events.ts";
import { fetchPlanStock } from "../ovh/availability.ts";
import { fetchCatalog, type Catalog, type CatalogPlan } from "../ovh/catalog.ts";
import { datacenterLabel, resolveDatacenter } from "../ovh/datacenters.ts";
import { formatMonthlyPrice } from "../ovh/price.ts";
import { mapSettled } from "../shared/concurrency.ts";
import { ApiError } from "../shared/http.ts";
import { log } from "../shared/log.ts";
import { pruneState, updateOrderability, updateStock } from "../state/diff.ts";
import { stockKey, type State } from "../state/schema.ts";

/** The catalog is 6+ MB: refresh it at most this often (or every tick with longer intervals). */
const CATALOG_MAX_AGE_MS = 30 * 60_000;
const MAX_PARALLEL_REQUESTS = 4;

export type TickOutcome = {
  events: AppEvent[];
  /** First error of the tick, or null. On an `incompatible` error the state must be discarded. */
  error: Error | null;
  catalog: Catalog | null;
};

/** Runs one check. Mutates `state`: pass a copy, and drop it if the outcome is incompatible. */
export async function runTick(config: Config, state: State, cached: Catalog | null, now: Date): Promise<TickOutcome> {
  const events: AppEvent[] = [];
  let error: Error | null = null;

  // 1. Catalog: orderability, plan details and datacenter labels.
  let catalog = cached?.subsidiary === config.subsidiary ? cached : null;
  if (!catalog || now.getTime() - catalog.fetchedAt.getTime() >= CATALOG_MAX_AGE_MS) {
    try {
      catalog = await fetchCatalog(config.subsidiary);
      state.catalogCheckedAt = now.toISOString();
      log.debug(`catalog refreshed: ${catalog.plans.size} plans`);
    } catch (err) {
      if (isIncompatible(err) || !catalog) return { events, error: err as Error, catalog };
      error = err as Error;
      log.warn(`catalog refresh failed, using the copy from ${catalog.fetchedAt.toISOString()}: ${error.message}`);
    }
  }

  if (state.subsidiary !== config.subsidiary) {
    // Plan codes and prices differ between subsidiaries: start over.
    Object.assign(state, { subsidiary: config.subsidiary, plans: {}, stock: {} });
  }
  state.intervalSeconds = config.intervalSeconds;
  state.datacenterLabels = Object.fromEntries(
    config.datacenters.map((code) => [code, datacenterLabel(catalog.datacenters.get(code) ?? resolveDatacenter(code))]),
  );

  // 2. Orderability of the monitored plans.
  for (const planCode of config.plans) {
    const issue = catalog.invalidPlans.get(planCode);
    if (issue) return { events, error: new ApiError("incompatible", `catalog: plan ${planCode}: ${issue}`), catalog };
  }
  const orderable: CatalogPlan[] = [];
  for (const planCode of config.plans) {
    const plan = catalog.plans.get(planCode);
    const info = plan ? planInfo(plan, catalog) : (state.plans[planCode]?.info ?? unknownPlan(planCode));
    const event = updateOrderability(state, info, plan?.orderable ?? false, now);
    if (event) events.push(event);
    if (plan?.orderable) orderable.push(plan);
  }

  // 3. Stock of the orderable plans in the monitored datacenters.
  const checks = orderable
    .map((plan) => ({ plan, datacenters: config.datacenters.filter((dc) => plan.datacenters.includes(dc)) }))
    .filter((check) => check.datacenters.length > 0);
  const results = await mapSettled(checks, MAX_PARALLEL_REQUESTS, ({ plan, datacenters }) =>
    fetchPlanStock(config.subsidiary, plan.planCode, datacenters, config.os),
  );

  for (const [i, result] of results.entries()) {
    const { plan, datacenters } = checks[i]!;
    if (result.status === "rejected") {
      if (isIncompatible(result.reason)) return { events, error: result.reason as Error, catalog };
      error ??= result.reason as Error;
      log.warn(`stock check of ${plan.planCode} failed: ${(result.reason as Error).message}`);
      continue;
    }
    for (const dc of datacenters) {
      for (const os of config.os) {
        const status = result.value.get(dc)?.[os];
        if (!status) {
          // Offered by the catalog but missing from the stock response: unknown, leave it as it was.
          log.debug(`no stock data for ${plan.planCode} in ${dc} (${os})`);
          continue;
        }
        const event = updateStock(state, stockKey(plan.planCode, dc, os), status, now, () => ({
          plan: state.plans[plan.planCode]!.info,
          datacenter: { code: dc, label: state.datacenterLabels[dc] ?? dc },
          os,
        }));
        if (event) events.push(event);
      }
    }
  }

  pruneState(
    state,
    new Set(config.plans),
    new Set(config.plans.flatMap((p) => config.datacenters.flatMap((dc) => config.os.map((os) => stockKey(p, dc, os))))),
  );
  state.lastCheck = now.toISOString();
  return { events, error, catalog };
}

export function planInfo(plan: CatalogPlan, catalog: Catalog): PlanInfo {
  return {
    planCode: plan.planCode,
    invoiceName: plan.invoiceName,
    vCore: plan.vCore,
    ramGb: plan.ramGb,
    price: formatMonthlyPrice(plan, catalog),
  };
}

function unknownPlan(planCode: string): PlanInfo {
  return { planCode, invoiceName: planCode, vCore: null, ramGb: null, price: "n/a" };
}

export function isIncompatible(err: unknown): err is ApiError {
  return err instanceof ApiError && err.kind === "incompatible";
}

import { mapSettled } from "../shared/concurrency.ts";
import { ApiError, fetchJson, parseOrIncompatible } from "../shared/http.ts";
import type { CatalogPlan } from "./catalog.ts";
import { availabilitySchema } from "./schemas.ts";
import { getSubsidiary } from "./subsidiaries.ts";

export type OperatingSystem = "linux" | "windows";
export type StockStatus = "available" | "out-of-stock";

export const OS_LABEL: Record<OperatingSystem, string> = { linux: "Linux", windows: "Windows" };

const KNOWN_STATUSES: readonly string[] = ["available", "out-of-stock"] satisfies StockStatus[];

/** Stock of one plan: datacenter code -> OS -> status. Only datacenters returned by OVH are present. */
export type PlanStock = Map<string, Partial<Record<OperatingSystem, StockStatus>>>;

const MAX_PARALLEL_REQUESTS = 4;

export type WatchedStock = {
  plan: CatalogPlan;
  /** The watched datacenters the plan is offered in. */
  datacenters: string[];
  result: PromiseSettledResult<PlanStock>;
};

/**
 * Stock of `plans` in the watched `datacenters` each one is offered in, in the order of `plans`,
 * with at most MAX_PARALLEL_REQUESTS requests at once. Plans offered in none of them are skipped.
 * Failures are returned, not thrown: the scraper and the TUI handle them differently.
 */
export async function fetchWatchedStock(
  subsidiaryCode: string,
  plans: readonly CatalogPlan[],
  datacenters: readonly string[],
  systems: readonly OperatingSystem[],
): Promise<WatchedStock[]> {
  const checks = plans
    .map((plan) => ({ plan, datacenters: datacenters.filter((dc) => plan.datacenters.includes(dc)) }))
    .filter((check) => check.datacenters.length > 0);
  const results = await mapSettled(checks, MAX_PARALLEL_REQUESTS, ({ plan, datacenters }) =>
    fetchPlanStock(subsidiaryCode, plan.planCode, datacenters, systems),
  );
  return checks.map((check, i) => ({ ...check, result: results[i]! }));
}

/**
 * Fetches the stock of `planCode`, keeping only `datacenters` and `systems`.
 * Unknown status values on those are an `incompatible` error; on anything else they're ignored.
 */
export async function fetchPlanStock(
  subsidiaryCode: string,
  planCode: string,
  datacenters: readonly string[],
  systems: readonly OperatingSystem[],
): Promise<PlanStock> {
  const { apiHost } = getSubsidiary(subsidiaryCode);
  const url = `https://${apiHost}/1.0/vps/order/rule/datacenter?ovhSubsidiary=${subsidiaryCode}&planCode=${encodeURIComponent(planCode)}`;
  return parsePlanStock(await fetchJson(url, 15_000), planCode, datacenters, systems);
}

export function parsePlanStock(
  raw: unknown,
  planCode: string,
  datacenters: readonly string[],
  systems: readonly OperatingSystem[],
): PlanStock {
  const data = parseOrIncompatible(availabilitySchema, raw, `availability(${planCode})`);
  const stock: PlanStock = new Map();
  for (const entry of data.datacenters) {
    if (!datacenters.includes(entry.datacenter)) continue;
    const statuses: Partial<Record<OperatingSystem, StockStatus>> = {};
    for (const os of systems) {
      const value = os === "linux" ? entry.linuxStatus : entry.windowsStatus;
      if (!KNOWN_STATUSES.includes(value)) {
        throw new ApiError("incompatible", `availability(${planCode}): ${entry.datacenter}.${os}Status has unknown value "${value}"`);
      }
      statuses[os] = value as StockStatus;
    }
    stock.set(entry.datacenter, statuses);
  }
  return stock;
}

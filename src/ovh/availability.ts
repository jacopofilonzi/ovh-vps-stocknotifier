import { ApiError, fetchJson, parseOrIncompatible } from "../shared/http.ts";
import { availabilitySchema } from "./schemas.ts";
import { getSubsidiary } from "./subsidiaries.ts";

export type OperatingSystem = "linux" | "windows";
export type StockStatus = "available" | "out-of-stock";

const KNOWN_STATUSES: readonly string[] = ["available", "out-of-stock"] satisfies StockStatus[];

/** Stock of one plan: datacenter code -> OS -> status. Only datacenters returned by OVH are present. */
export type PlanStock = Map<string, Partial<Record<OperatingSystem, StockStatus>>>;

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

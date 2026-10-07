import { fetchPlanStock } from "./ovh/availability.ts";
import { fetchCatalog } from "./ovh/catalog.ts";
import { ApiError } from "./shared/http.ts";

// One subsidiary per API host.
const SUBSIDIARIES = ["IT", "CA", "US"];

/**
 * Checks the live OVH APIs still match the schemas this version relies on.
 * Exits with 1 on any failure, so CI can alert on API changes.
 */
export async function runSmoke(): Promise<number> {
  let failed = false;
  for (const subsidiary of SUBSIDIARIES) {
    try {
      const catalog = await fetchCatalog(subsidiary);
      const orderable = [...catalog.plans.values()].filter((p) => p.orderable);
      const plan = orderable[0]!;
      const stock = await fetchPlanStock(subsidiary, plan.planCode, plan.datacenters, ["linux", "windows"]);
      if (stock.size === 0) throw new Error(`availability(${plan.planCode}): none of its datacenters were returned`);
      console.log(
        `ok   ${subsidiary.padEnd(4)} ${orderable.length} orderable plans, ${catalog.datacenters.size} datacenters, ` +
          `${plan.planCode} stock in ${stock.size} datacenters`,
      );
    } catch (err) {
      failed = true;
      const kind = err instanceof ApiError ? err.kind : "error";
      console.error(`FAIL ${subsidiary.padEnd(4)} [${kind}] ${(err as Error).message}`);
    }
  }
  return failed ? 1 : 0;
}

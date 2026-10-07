import { checkbox, confirm, search, Separator } from "@inquirer/prompts";
import type { Config } from "../config/schema.ts";
import type { Catalog } from "../ovh/catalog.ts";
import { datacenterLabel } from "../ovh/datacenters.ts";
import { SUBSIDIARIES, getSubsidiary } from "../ovh/subsidiaries.ts";
import { getCatalog } from "./catalog.ts";
import { ask, BACK, dim, yellow, type Back } from "./prompt.ts";

/** Subsidiary step. Changing it drops the datacenters and plans that don't exist there (after confirming). */
export async function editSubsidiary(config: Config): Promise<Config | Back> {
  while (true) {
    const code = await ask(search<string>, {
      message: "OVH subsidiary (prices, currency and VAT)",
      source: (term) =>
        SUBSIDIARIES.filter((s) => `${s.code} ${s.name}`.toLowerCase().includes((term ?? "").toLowerCase())).map((s) => ({
          name: `${s.code.padEnd(5)} ${s.name}`,
          short: `${s.code} · ${s.name}`,
          value: s.code,
        })),
      default: config.subsidiary,
      pageSize: 12,
    });
    if (code === BACK) return BACK;
    const catalog = await getCatalog(code);
    if (catalog === BACK) continue;

    const next = { ...config, subsidiary: code };
    const datacenters = config.datacenters.filter((dc) => catalog.datacenters.has(dc));
    const plans = config.plans.filter((p) => catalog.plans.has(p));
    const lost = [
      ...config.datacenters.filter((dc) => !datacenters.includes(dc)),
      ...config.plans.filter((p) => !plans.includes(p)),
    ];
    if (lost.length > 0) {
      console.log(yellow(`Not available with ${getSubsidiary(code).name}: ${lost.join(", ")}`));
      const ok = await ask(confirm, { message: "Remove them and switch subsidiary?", default: true });
      if (ok !== true) continue;
    }
    return { ...next, datacenters, plans };
  }
}

/** Datacenter step. Plans no longer offered in any selected datacenter are dropped (after confirming). */
export async function editDatacenters(config: Config, catalog: Catalog): Promise<Config | Back> {
  const all = [...catalog.datacenters.values()].sort(
    (a, b) => a.countryCode.localeCompare(b.countryCode) || a.city.localeCompare(b.city),
  );
  const regular = all.filter((dc) => !dc.localZone).map((dc) => choice(dc, config));
  const localZones = all.filter((dc) => dc.localZone).map((dc) => choice(dc, config));
  while (true) {
    const selected = await ask(checkbox<string>, {
      message: "Datacenters to watch",
      choices: [...regular, ...(localZones.length ? [new Separator(dim("── Local Zones ──")), ...localZones] : [])],
      required: true,
      pageSize: 20,
    });
    if (selected === BACK) return BACK;

    const next = { ...config, datacenters: selected };
    const orphans = config.plans.filter((p) => !isPlanCompatible(p, next, catalog));
    if (orphans.length > 0) {
      const names = orphans.map((p) => catalog.plans.get(p)?.invoiceName ?? p).join(", ");
      console.log(yellow(`Not offered in the selected datacenters: ${names}`));
      const ok = await ask(confirm, { message: "Stop watching them?", default: true });
      if (ok !== true) continue;
    }
    return { ...next, plans: config.plans.filter((p) => !orphans.includes(p)) };
  }
}

function choice(dc: { code: string; city: string; countryCode: string; localZone: boolean }, config: Config) {
  return { name: datacenterLabel(dc), value: dc.code, checked: config.datacenters.includes(dc.code) };
}

/** A plan can stay watched if it's offered in a selected datacenter, or withdrawn (to see it come back). */
export function isPlanCompatible(planCode: string, config: Config, catalog: Catalog): boolean {
  const plan = catalog.plans.get(planCode);
  if (!plan?.orderable) return true;
  return plan.datacenters.some((dc) => config.datacenters.includes(dc));
}

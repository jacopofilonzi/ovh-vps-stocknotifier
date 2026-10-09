import { checkbox, Separator } from "@inquirer/prompts";
import type { Config } from "../config/schema.ts";
import type { Catalog, CatalogPlan } from "../ovh/catalog.ts";
import { formatMonthlyPrice } from "../ovh/price.ts";
import { formatColumns } from "../shared/table.ts";
import { ask, BACK, dim, pause, yellow, type Back } from "./prompt.ts";

/**
 * Plans step: the plans on sale in at least one selected datacenter, by price.
 * Plans already watched but withdrawn stay listed (and checked), so they can be unchecked.
 */
export async function editPlans(config: Config, catalog: Catalog): Promise<Config | Back> {
  const onSale = [...catalog.plans.values()]
    .filter((p) => p.orderable && p.datacenters.some((dc) => config.datacenters.includes(dc)))
    .sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity));
  const withdrawn = config.plans.filter((code) => !onSale.some((p) => p.planCode === code));

  if (onSale.length === 0 && withdrawn.length === 0) {
    // Paused: the caller clears the screen right after going back.
    await pause([yellow("No plan is on sale in the selected datacenters: pick other datacenters first.")]);
    return BACK;
  }

  // Same name in different plans (e.g. US "-eu"/"-ca" variants): show the plan code too.
  const names = onSale.map((p) => p.invoiceName);
  const showCode = (p: CatalogPlan) => names.indexOf(p.invoiceName) !== names.lastIndexOf(p.invoiceName);

  const lines = formatColumns(
    [
      ["Plan", "vCore", "RAM", "Price/month", ""],
      ...onSale.map((p) => [
        p.invoiceName,
        p.vCore?.toString() ?? "-",
        p.ramGb !== null ? `${p.ramGb} GB` : "-",
        formatMonthlyPrice(p, catalog),
        showCode(p) ? dim(p.planCode) : "",
      ]),
    ],
    { right: [1, 2] },
  );

  const selected = await ask(checkbox<string>, {
    message: "Plans to watch",
    choices: [
      new Separator(`  ${lines[0]}`),
      ...onSale.map((p, i) => ({
        name: lines[i + 1]!,
        short: p.invoiceName,
        value: p.planCode,
        checked: config.plans.includes(p.planCode),
      })),
      ...withdrawn.map((code) => ({
        name: `${catalog.plans.get(code)?.invoiceName ?? code} ${yellow("(withdrawn)")}`,
        short: catalog.plans.get(code)?.invoiceName ?? code,
        value: code,
        checked: true,
      })),
    ],
    required: true,
    pageSize: 20,
  });
  if (selected === BACK) return BACK;
  return { ...config, plans: selected };
}

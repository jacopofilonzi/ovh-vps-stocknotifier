import { confirm } from "@inquirer/prompts";
import { checkResultLines, requestCheck } from "../check-now.ts";
import type { Config } from "../config/schema.ts";
import type { StockEvent } from "../events.ts";
import { OS_LABEL } from "../ovh/availability.ts";
import { formatColumns } from "../shared/table.ts";
import { getCatalog } from "./catalog.ts";
import { liveEvents } from "./preview.ts";
import { ask, BACK, dim, pause, withSpinner, yellow } from "./prompt.ts";

/**
 * Asks the scraper for an immediate check (it notifies and updates the state as usual).
 * If the scraper isn't running, offers a read-only check instead: shown here, nothing notified or stored.
 */
export async function checkNow(config: Config) {
  const result = await withSpinner("Waiting for the scraper to check", requestCheck);
  const lines = await checkResultLines(result);
  if (result.status !== "unavailable") return pause(lines);

  console.log(yellow(lines.join("\n")) + "\n");
  const readOnly = await ask(confirm, {
    message: "Check the live stock from here instead? (read-only: nothing is notified or saved)",
    default: true,
  });
  if (readOnly !== true) return;
  const catalog = await getCatalog(config.subsidiary);
  if (catalog === BACK) return;
  const events = await withSpinner("Fetching live stock", () => liveEvents(config, catalog));
  await pause(liveTable(config, events));
}

/** Plans × datacenters table of live events. */
function liveTable(config: Config, events: Awaited<ReturnType<typeof liveEvents>>): string[] {
  const stock = events.filter((e): e is StockEvent => e.kind === "stock");
  const withdrawn = new Set(events.flatMap((e) => (e.kind === "orderability" ? [e.plan.planCode] : [])));
  const labels = new Map(stock.map((e) => [e.datacenter.code, e.datacenter.label]));
  const datacenters = config.datacenters.filter((dc) => labels.has(dc));
  const plans = new Map(events.flatMap((e) => (e.kind === "stock" || e.kind === "orderability" ? [[e.plan.planCode, e.plan]] : [])));

  const rows = config.plans
    .filter((code) => plans.has(code))
    .map((code) => [
      plans.get(code)!.invoiceName,
      ...datacenters.map((dc) => {
        if (withdrawn.has(code)) return "⚠️ withdrawn";
        const cells = stock
          .filter((e) => e.plan.planCode === code && e.datacenter.code === dc)
          .map((e) => `${e.status === "available" ? "🟢" : "🔴"}${config.os.length > 1 ? ` ${OS_LABEL[e.os]}` : ""}`);
        return cells.join(" · ") || "-";
      }),
    ]);
  if (rows.length === 0) return ["No watched plan is offered in the selected datacenters."];
  return [
    dim("Live stock (read-only, not saved):"),
    "",
    ...formatColumns([["Plan", ...datacenters.map((dc) => labels.get(dc)!)], ...rows]),
  ];
}

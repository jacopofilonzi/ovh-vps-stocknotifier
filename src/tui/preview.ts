import type { Config, NotifierConfig } from "../config/schema.ts";
import { planInfo, unknownPlanInfo, type AppEvent, type Notification } from "../events.ts";
import { sendWith } from "../notifiers/index.ts";
import { fetchWatchedStock } from "../ovh/availability.ts";
import type { Catalog, CatalogPlan } from "../ovh/catalog.ts";
import { datacenterLabel, resolveDatacenter } from "../ovh/datacenters.ts";
import { getSubsidiary } from "../ovh/subsidiaries.ts";
import { green, red, withSpinner } from "./prompt.ts";

/** Sends a simple "it works" notification. */
export function sendTest(config: Config, notifiers: NotifierConfig[]) {
  return sendAndReport(notifiers, notification(config, [{ kind: "test" }]));
}

/**
 * Sends the current stock of the watched plans as if it had just changed, marked [TEST].
 * Doesn't touch state.json.
 */
export async function sendLivePreview(config: Config, catalog: Catalog, notifiers: NotifierConfig[]) {
  const events = await withSpinner("Fetching live stock", () => liveEvents(config, catalog));
  if (events.length === 0) {
    console.log(red("Nothing to preview: no watched plan is offered in the selected datacenters."));
    return;
  }
  await sendAndReport(notifiers, notification(config, events));
}

/** Current stock of the watched plans, as events. Read-only: nothing is stored or notified. */
export async function liveEvents(config: Config, catalog: Catalog): Promise<AppEvent[]> {
  const events: AppEvent[] = [];
  const orderable: CatalogPlan[] = [];
  for (const planCode of config.plans) {
    const plan = catalog.plans.get(planCode);
    if (plan?.orderable) {
      orderable.push(plan);
    } else {
      events.push({ kind: "orderability", orderable: false, plan: plan ? planInfo(plan, catalog) : unknownPlanInfo(planCode) });
    }
  }
  const checks = await fetchWatchedStock(config.subsidiary, orderable, config.datacenters, config.os);
  for (const { plan, datacenters, result } of checks) {
    if (result.status === "rejected") {
      console.log(red(`Stock of ${plan.planCode} unavailable: ${(result.reason as Error).message}`));
      continue;
    }
    for (const dc of datacenters) {
      for (const os of config.os) {
        const status = result.value.get(dc)?.[os];
        if (!status) continue;
        const label = datacenterLabel(catalog.datacenters.get(dc) ?? resolveDatacenter(dc));
        events.push({ kind: "stock", status, plan: planInfo(plan, catalog), datacenter: { code: dc, label }, os });
      }
    }
  }
  return events;
}

function notification(config: Config, events: AppEvent[]): Notification {
  return { events, subsidiary: config.subsidiary, orderUrl: getSubsidiary(config.subsidiary).orderUrl, test: true };
}

async function sendAndReport(notifiers: NotifierConfig[], notification: Notification): Promise<boolean> {
  const results = await withSpinner("Sending", () =>
    Promise.allSettled(notifiers.map((n) => sendWith(n, notification))),
  );
  results.forEach((result, i) => {
    const { name } = notifiers[i]!;
    console.log(result.status === "fulfilled" ? green(`✓ ${name}: sent`) : red(`✗ ${name}: ${(result.reason as Error).message}`));
  });
  return results.every((r) => r.status === "fulfilled");
}

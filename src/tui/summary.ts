import type { Config } from "../config/schema.ts";
import { OS_LABEL } from "../ovh/availability.ts";
import type { Catalog } from "../ovh/catalog.ts";
import { datacenterLabel, resolveDatacenter } from "../ovh/datacenters.ts";
import { getSubsidiary } from "../ovh/subsidiaries.ts";
import { formatColumns } from "../shared/table.ts";
import { APP_NAME, APP_VERSION } from "../shared/version.ts";
import type { State } from "../state/schema.ts";
import { formatTime } from "../shared/time.ts";
import { liveness } from "../state/liveness.ts";
import { formatInterval } from "./options.ts";
import { bold, dim, green, red, yellow } from "./prompt.ts";

/** Config values as shown in the summary and in the main menu. */
export function describe(config: Config, catalog: Catalog | null, state: State | null) {
  const subsidiary = getSubsidiary(config.subsidiary);
  const enabled = config.notifiers.filter((n) => n.enabled);
  return {
    subsidiary: `${subsidiary.code} · ${subsidiary.name}${catalog ? ` (${catalog.currency})` : ""}`,
    datacenters:
      config.datacenters
        .map((dc) => catalog?.datacenters.get(dc) ?? null)
        .map((dc, i) => (dc ? datacenterLabel(dc) : (state?.datacenterLabels[config.datacenters[i]!] ?? datacenterLabel(resolveDatacenter(config.datacenters[i]!)))))
        .join(", ") || yellow("none"),
    os: config.os.map((os) => OS_LABEL[os]).join(", "),
    plans:
      config.plans
        .map((p) => {
          const plan = catalog?.plans.get(p);
          const name = plan?.invoiceName ?? state?.plans[p]?.info.invoiceName ?? p;
          return catalog && !plan?.orderable ? `${name} ${yellow("(withdrawn)")}` : name;
        })
        .join(", ") || yellow("none"),
    notifiers:
      config.notifiers
        .map((n) => {
          if (!n.enabled) return dim(`${n.name} ✗`);
          return state?.failingNotifiers[n.id] ? yellow(`${n.name} ⚠️ failing`) : `${n.name} ${green("✓")}`;
        })
        .join(", ") + (enabled.length === 0 ? yellow(`${config.notifiers.length ? " · " : ""}⚠️ none enabled`) : ""),
    interval: formatInterval(config.intervalSeconds),
  };
}

export function scraperStatus(state: State | null): string {
  switch (liveness(state)) {
    case "never-started":
      return dim("not started yet");
    case "stopped":
      return yellow(`⏹ stopped at ${formatTime(state!.heartbeat)}`);
    case "dead":
      return red(`⚠️ not responding since ${formatTime(state!.heartbeat)} (crashed?)`);
    case "waiting-config":
      return "waiting for a configuration";
    case "halted":
      return red(`⛔ halted: ${state!.health.signature}. Update to a newer version`);
    case "running":
      if (state!.health.status === "degraded") return yellow(`🛠️ degraded: ${state!.health.lastError}`);
      return green(`✅ running · last check ${formatTime(state!.lastCheck)}`);
  }
}

/** Summary shown above menus. The scraper row is shown only when `state` is passed (null: no state.json). */
export function summaryLines(config: Config, catalog: Catalog | null, state?: State | null): string[] {
  const d = describe(config, catalog, state ?? null);
  const rows = [
    ["Subsidiary", d.subsidiary],
    ["Datacenters", d.datacenters],
    ["OS", d.os],
    ["Plans", d.plans],
    ["Notifiers", d.notifiers],
    ["Interval", d.interval],
    ...(state !== undefined ? [["Scraper", scraperStatus(state)]] : []),
  ];
  return [bold(`${APP_NAME} ${dim(APP_VERSION)}`), ...formatColumns(rows).map((line) => ` ${line}`), ""];
}

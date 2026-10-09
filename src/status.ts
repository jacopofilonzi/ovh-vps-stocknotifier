import { loadConfig } from "./config/store.ts";
import { OS_LABEL, type OperatingSystem } from "./ovh/availability.ts";
import { formatColumns } from "./shared/table.ts";
import { STATE_PATH } from "./shared/paths.ts";
import { formatTime } from "./shared/time.ts";
import { describeLiveness, liveness } from "./state/liveness.ts";
import { stockKey, type State } from "./state/schema.ts";
import { peekState } from "./state/store.ts";

/** The status table shown by `make status` and in the TUI, from the stored state. */
export async function statusLines(): Promise<string[]> {
  const state = await peekState();
  if (!state) return [`No readable state yet (${STATE_PATH}): the scraper hasn't run.`];

  const config = await loadConfig();
  const datacenters = config.status === "ok" ? config.config.datacenters : Object.keys(state.datacenterLabels);
  const systems = config.status === "ok" ? config.config.os : (["linux", "windows"] as const);

  const header = ["Plan", "vCore", "RAM", "Price/month", ...datacenters.map((dc) => state.datacenterLabels[dc] ?? dc)];
  const rows = Object.values(state.plans).map(({ info, orderable }) => [
    info.invoiceName,
    info.vCore?.toString() ?? "-",
    info.ramGb !== null ? `${info.ramGb} GB` : "-",
    info.price,
    ...datacenters.map((dc) =>
      orderable ? stockCell(state, info.planCode, dc, systems) : "⚠️ withdrawn",
    ),
  ]);

  return [
    ...healthLines(state),
    "",
    ...(rows.length ? formatColumns([header, ...rows], { right: [1, 2] }) : ["No plan checked yet."]),
    "",
    `Last check: ${formatTime(state.lastCheck)} · Catalog refreshed: ${formatTime(state.catalogCheckedAt)}`,
  ];
}

function stockCell(state: State, planCode: string, dc: string, systems: readonly OperatingSystem[]): string {
  const parts = systems.flatMap((os) => {
    const stock = state.stock[stockKey(planCode, dc, os)];
    if (!stock) return [];
    const mark = stock.status === "available" ? "🟢" : "🔴";
    return [systems.length > 1 ? `${mark} ${OS_LABEL[os]}` : `${mark} since ${formatTime(stock.since)}`];
  });
  return parts.length ? parts.join(" · ") : "-";
}

function healthLines(state: State): string[] {
  const { health } = state;
  const live = liveness(state);
  if (live === "stopped" || live === "dead" || live === "waiting-config") return [`⚠️ ${describeLiveness(state)}.`];
  if (health.status === "halted") {
    return [`⛔ Scraper stopped since ${formatTime(health.since)}: ${health.signature}`, "Update to a newer version."];
  }
  if (health.status === "degraded") return [`🛠️ Monitoring degraded since ${formatTime(health.since)}: ${health.lastError}`];
  return [`✅ Monitoring OK`];
}

export async function runStatus(): Promise<number> {
  console.log((await statusLines()).join("\n"));
  return 0;
}

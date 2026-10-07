// Debug script: plans orderable in Milan, from the local catalog snapshot, with live stock.
// Usage: node scripts/vps-italia.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchPlanStock } from "../src/ovh/availability.ts";
import { parseCatalog } from "../src/ovh/catalog.ts";
import { datacenterLabel } from "../src/ovh/datacenters.ts";
import { formatMonthlyPrice } from "../src/ovh/price.ts";

const DATACENTER = "EU-SOUTH-MIL";

const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, "dataset.json"), "utf8"));
const catalog = parseCatalog(raw, "IT");

const plans = [...catalog.plans.values()]
  .filter((p) => p.orderable && p.datacenters.includes(DATACENTER))
  .sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity));

const rows = await Promise.all(
  plans.map(async (plan) => {
    const stock = await fetchPlanStock("IT", plan.planCode, plan.datacenters, ["linux"]);
    const availableIn = [...stock]
      .filter(([, os]) => os.linux === "available")
      .map(([code]) => catalog.datacenters.get(code))
      .map((dc) => (dc ? datacenterLabel(dc) : "?"));
    return {
      planCode: plan.planCode,
      invoiceName: plan.invoiceName,
      vCore: plan.vCore,
      "RAM (GB)": plan.ramGb,
      "Price/month": formatMonthlyPrice(plan, catalog),
      "Available in (Linux)": availableIn.join(", ") || "-",
    };
  }),
);

console.table(rows);

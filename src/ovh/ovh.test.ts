import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ApiError } from "../shared/http.ts";
import { parsePlanStock } from "./availability.ts";
import { parseCatalog } from "./catalog.ts";
import { datacenterLabel, resolveDatacenter } from "./datacenters.ts";
import { formatMonthlyPrice } from "./price.ts";

// Real catalog snapshot (IT subsidiary), downloaded from the public API.
const dataset = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../scripts/dataset.json"), "utf8"));

function assertIncompatible(fn: () => unknown, pattern: RegExp) {
  assert.throws(fn, (err) => err instanceof ApiError && err.kind === "incompatible" && pattern.test(err.signature));
}

describe("parseCatalog", () => {
  const catalog = parseCatalog(dataset, "IT");

  it("reads locale and orderable plans", () => {
    assert.equal(catalog.currency, "EUR");
    assert.equal(catalog.taxRate, 22);
    const orderable = [...catalog.plans.values()].filter((p) => p.orderable).map((p) => p.planCode);
    assert.deepEqual(orderable.sort(), [
      "vps-2027-model1",
      "vps-2027-model1.LZ",
      "vps-2027-model2",
      "vps-2027-model2.LZ",
      "vps-2027-model3",
      "vps-2027-model4",
    ]);
    assert.equal(catalog.invalidPlans.size, 0);
  });

  it("links specs, price and datacenters", () => {
    const plan = catalog.plans.get("vps-2027-model2")!;
    assert.equal(plan.invoiceName, "VPS-2 2027");
    assert.equal(plan.vCore, 4);
    assert.equal(plan.ramGb, 8);
    assert.deepEqual(plan.price, { amount: 8.49, tax: 1.8678 });
    assert.ok(plan.datacenters.includes("EU-SOUTH-MIL"));
    assert.equal(formatMonthlyPrice(plan, catalog), "€8.49 + VAT (€10.36)");
  });

  it("labels datacenters, local zones included", () => {
    assert.equal(datacenterLabel(catalog.datacenters.get("EU-SOUTH-MIL")!), "Milano (IT)");
    assert.equal(datacenterLabel(catalog.datacenters.get("EU-WEST-LZ-AMS")!), "Amsterdam LZ (NL)");
    assert.equal(datacenterLabel(resolveDatacenter("XX-NEW")), "XX-NEW");
  });

  it("ignores extra fields and broken non-critical data", () => {
    const copy = structuredClone(dataset);
    copy.newTopLevelField = { anything: true };
    copy.products = copy.products.map(() => ({ broken: true }));
    const result = parseCatalog(copy, "IT");
    const plan = result.plans.get("vps-2027-model2")!;
    assert.equal(plan.orderable, true);
    assert.equal(plan.vCore, null);
  });

  it("records plans with broken critical fields", () => {
    const copy = structuredClone(dataset);
    const plan = copy.plans.find((p: { planCode: string }) => p.planCode === "vps-2027-model1");
    plan.configurations = "renamed";
    const result = parseCatalog(copy, "IT");
    assert.match(result.invalidPlans.get("vps-2027-model1")!, /configurations/);
    assert.equal(result.plans.has("vps-2027-model1"), false);
  });

  it("is incompatible when the root shape changes", () => {
    assertIncompatible(() => parseCatalog({ ...dataset, plans: undefined }, "IT"), /^catalog: plans/);
  });

  it("is incompatible when no plan is orderable", () => {
    const copy = structuredClone(dataset);
    for (const plan of copy.plans) if (plan.blobs) plan.blobs.tags = [];
    assertIncompatible(() => parseCatalog(copy, "IT"), /no plan is tagged/);
  });
});

describe("parsePlanStock", () => {
  const response = {
    datacenters: [
      { datacenter: "EU-SOUTH-MIL", linuxStatus: "available", windowsStatus: "out-of-stock", extra: 1 },
      { datacenter: "GRA", linuxStatus: "out-of-stock", windowsStatus: "something-new" },
    ],
  };

  it("keeps only the requested datacenters and systems", () => {
    const stock = parsePlanStock(response, "p", ["EU-SOUTH-MIL", "SBG"], ["linux"]);
    assert.deepEqual([...stock], [["EU-SOUTH-MIL", { linux: "available" }]]);
  });

  it("ignores unknown values on systems that aren't monitored", () => {
    const stock = parsePlanStock(response, "p", ["GRA"], ["linux"]);
    assert.deepEqual(stock.get("GRA"), { linux: "out-of-stock" });
  });

  it("is incompatible on unknown values for monitored systems", () => {
    assertIncompatible(() => parsePlanStock(response, "p", ["GRA"], ["windows"]), /GRA\.windowsStatus has unknown value "something-new"/);
  });

  it("is incompatible when a field is renamed", () => {
    const renamed = { datacenters: [{ datacenter: "GRA", linux: "available", windowsStatus: "available" }] };
    assertIncompatible(() => parsePlanStock(renamed, "p", ["GRA"], ["linux"]), /linuxStatus/);
  });
});

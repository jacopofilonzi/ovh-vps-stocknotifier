import { ApiError, describeIssue, fetchJson, parseOrIncompatible } from "../shared/http.ts";
import { resolveDatacenter, type Datacenter } from "./datacenters.ts";
import { catalogRootSchema, planCriticalSchema, planPricingsSchema, productSchema } from "./schemas.ts";
import { getSubsidiary } from "./subsidiaries.ts";

/** Plans tagged like this are the ones OVH shows in its order funnel, i.e. actually on sale. */
const ORDERABLE_TAG = "order-funnel:show";

/** Catalog prices are integers in 1e-8 currency units: 449000000 => 4.49. */
const PRICE_UNIT = 1e8;

export type CatalogPlan = {
  planCode: string;
  invoiceName: string;
  orderable: boolean;
  /** Datacenter codes the plan can be ordered in. */
  datacenters: string[];
  vCore: number | null;
  ramGb: number | null;
  diskGb: number | null;
  /** Monthly price without commitment, in currency units. */
  price: { amount: number; tax: number } | null;
};

export type Catalog = {
  subsidiary: string;
  currency: string;
  taxRate: number;
  fetchedAt: Date;
  plans: Map<string, CatalogPlan>;
  /** Plans whose critical fields don't match the schema: plan code -> issue. */
  invalidPlans: Map<string, string>;
  /** Datacenters of the orderable plans. */
  datacenters: Map<string, Datacenter>;
};

export async function fetchCatalog(subsidiaryCode: string): Promise<Catalog> {
  const { apiHost } = getSubsidiary(subsidiaryCode);
  const data = await fetchJson(`https://${apiHost}/v1/order/catalog/public/vps?ovhSubsidiary=${subsidiaryCode}`, 30_000);
  return parseCatalog(data, subsidiaryCode);
}

/** Reduces the raw catalog to what the app needs. Throws an `incompatible` ApiError if it can't. */
export function parseCatalog(data: unknown, subsidiary: string): Catalog {
  const root = parseOrIncompatible(catalogRootSchema, data, "catalog");

  const specs = new Map<string, Pick<CatalogPlan, "vCore" | "ramGb" | "diskGb">>();
  const datacenterMeta = new Map<string, { city: string; country: string }>();
  for (const raw of root.products) {
    const product = productSchema.safeParse(raw);
    if (!product.success) continue;
    const { name, blobs } = product.data;
    specs.set(name, {
      vCore: blobs?.technical?.cpu?.cores ?? null,
      ramGb: blobs?.technical?.memory?.size ?? null,
      diskGb: blobs?.technical?.storage?.disks[0]?.capacity ?? null,
    });
    for (const config of blobs?.meta?.configurations ?? []) {
      if (config.name !== "vps_datacenter") continue;
      for (const { value, blobs } of config.values) {
        if (blobs.technical.datacenter) datacenterMeta.set(value, blobs.technical.datacenter);
      }
    }
  }

  const plans = new Map<string, CatalogPlan>();
  const invalidPlans = new Map<string, string>();
  root.plans.forEach((raw, index) => {
    const parsed = planCriticalSchema.safeParse(raw);
    if (!parsed.success) {
      const planCode = (raw as { planCode?: unknown } | null)?.planCode;
      invalidPlans.set(typeof planCode === "string" ? planCode : `plans[${index}]`, describeIssue(parsed.error));
      return;
    }
    const plan = parsed.data;
    const pricings = planPricingsSchema.safeParse((raw as { pricings?: unknown }).pricings);
    const monthly = pricings.success
      ? pricings.data.find((p) => p.mode === "default" && p.capacities.includes("renew") && p.interval === 1)
      : undefined;
    plans.set(plan.planCode, {
      planCode: plan.planCode,
      invoiceName: plan.invoiceName ?? plan.planCode,
      orderable: plan.blobs?.tags?.includes(ORDERABLE_TAG) ?? false,
      datacenters: plan.configurations.find((c) => c.name === "vps_datacenter")?.values ?? [],
      ...(specs.get(plan.product ?? "") ?? { vCore: null, ramGb: null, diskGb: null }),
      price: monthly ? { amount: monthly.price / PRICE_UNIT, tax: monthly.tax / PRICE_UNIT } : null,
    });
  });

  const orderable = [...plans.values()].filter((p) => p.orderable);
  if (orderable.length === 0) {
    // Either OVH stopped selling VPS, or it changed how orderable plans are marked: both mean
    // this version can't tell which plans are on sale anymore.
    throw new ApiError("incompatible", `catalog: no plan is tagged "${ORDERABLE_TAG}"`);
  }

  const datacenters = new Map<string, Datacenter>();
  for (const plan of orderable) {
    for (const code of plan.datacenters) {
      if (!datacenters.has(code)) datacenters.set(code, resolveDatacenter(code, datacenterMeta.get(code)));
    }
  }

  return {
    subsidiary,
    currency: root.locale.currencyCode,
    taxRate: root.locale.taxRate,
    fetchedAt: new Date(),
    plans,
    invalidPlans,
    datacenters,
  };
}

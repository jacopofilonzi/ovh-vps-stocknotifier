import type { OperatingSystem, StockStatus } from "./ovh/availability.ts";
import type { Catalog, CatalogPlan } from "./ovh/catalog.ts";
import { formatMonthlyPrice } from "./ovh/price.ts";

/** What notifications show about a plan, resolved from the catalog when the event happens. */
export type PlanInfo = {
  planCode: string;
  invoiceName: string;
  vCore: number | null;
  ramGb: number | null;
  /** Formatted monthly price, e.g. "€4.49 + VAT (€5.48)". */
  price: string;
};

export function planInfo(plan: CatalogPlan, catalog: Catalog): PlanInfo {
  return {
    planCode: plan.planCode,
    invoiceName: plan.invoiceName,
    vCore: plan.vCore,
    ramGb: plan.ramGb,
    price: formatMonthlyPrice(plan, catalog),
  };
}

/** For a watched plan that is no longer in the catalog. */
export function unknownPlanInfo(planCode: string): PlanInfo {
  return { planCode, invoiceName: planCode, vCore: null, ramGb: null, price: "n/a" };
}

export type StockEvent = {
  kind: "stock";
  status: StockStatus;
  plan: PlanInfo;
  datacenter: { code: string; label: string };
  os: OperatingSystem;
};

export type OrderabilityEvent = {
  kind: "orderability";
  orderable: boolean;
  plan: PlanInfo;
};

/** Problems of the app itself: OVH API errors, incompatible responses, corrupted state. */
export type HealthEvent = {
  kind: "health";
  status: "degraded" | "recovered" | "halted" | "state-reset";
  detail: string;
};

export type NotifierHealthEvent = {
  kind: "notifier";
  id: string;
  name: string;
  failing: boolean;
  error?: string;
};

/** Sent from the TUI to check a notifier works. */
export type TestEvent = {
  kind: "test";
};

export type AppEvent = StockEvent | OrderabilityEvent | HealthEvent | NotifierHealthEvent | TestEvent;

export type Notification = {
  events: AppEvent[];
  subsidiary: string;
  orderUrl: string;
  /** Sent from the TUI: titles get a [TEST] marker. */
  test?: boolean;
};

import type { Catalog, CatalogPlan } from "./catalog.ts";

/** "€4.49 + VAT (€5.48)", or "$10.00 excl. tax" where the catalog has no tax (taxes added at checkout). */
export function formatMonthlyPrice(plan: CatalogPlan, catalog: Pick<Catalog, "currency">): string {
  if (!plan.price) return "n/a";
  const money = new Intl.NumberFormat("en", { style: "currency", currency: catalog.currency });
  const { amount, tax } = plan.price;
  if (tax === 0) return `${money.format(amount)} excl. tax`;
  return `${money.format(amount)} + VAT (${money.format(amount + tax)})`;
}

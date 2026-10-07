import { z } from "zod";

/** Bump when the state shape changes: an older state.json is then discarded and rebuilt from scratch. */
export const STATE_SCHEMA_VERSION = 1;

const isoDate = z.iso.datetime();

const planInfoSchema = z.object({
  planCode: z.string(),
  invoiceName: z.string(),
  vCore: z.number().nullable(),
  ramGb: z.number().nullable(),
  price: z.string(),
});

export const stateSchema = z.object({
  stateSchemaVersion: z.literal(STATE_SCHEMA_VERSION),
  appVersion: z.string(),
  phase: z.enum(["waiting-config", "running", "halted"]),
  /** Updated every tick and every minute while waiting: tells the healthcheck the process is alive. */
  heartbeat: isoDate,
  /** Subsidiary the plans and stock below refer to: they're reset when it changes. */
  subsidiary: z.string().optional(),
  intervalSeconds: z.number().optional(),
  lastCheck: isoDate.optional(),
  lastSuccess: isoDate.optional(),
  catalogCheckedAt: isoDate.optional(),

  /** Monitored plans, by plan code. `info` is kept for notifications and the status table. */
  plans: z.record(
    z.string(),
    z.object({ orderable: z.boolean(), since: isoDate, info: planInfoSchema }),
  ),
  /** Stock by `plan@datacenter#os`. */
  stock: z.record(
    z.string(),
    z.object({ status: z.enum(["available", "out-of-stock"]), since: isoDate, lastCheck: isoDate }),
  ),
  /** Labels of the monitored datacenters, e.g. "EU-SOUTH-MIL" -> "Milano (IT)". */
  datacenterLabels: z.record(z.string(), z.string()),

  health: z.object({
    status: z.enum(["ok", "degraded", "halted"]),
    since: isoDate,
    lastError: z.string().optional(),
    /** Consecutive failed ticks. */
    failures: z.number(),
    /** Incompatible-response signature being confirmed (or that caused the halt). */
    signature: z.string().optional(),
    /** Consecutive attempts that hit `signature`. */
    attempts: z.number(),
    /** Version that halted: a different version starts fresh. */
    haltedVersion: z.string().optional(),
    /** Whether the current degraded/halted status has been notified. */
    notified: z.boolean(),
  }),

  /** Notifiers that are failing, by notifier id. */
  failingNotifiers: z.record(
    z.string(),
    z.object({ since: isoDate, error: z.string(), reported: z.boolean() }),
  ),
});

export type State = z.infer<typeof stateSchema>;
export type PlanState = State["plans"][string];
export type StockState = State["stock"][string];

export function stockKey(planCode: string, datacenter: string, os: string) {
  return `${planCode}@${datacenter}#${os}`;
}

export function freshState(appVersion: string, now: Date): State {
  return {
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    appVersion,
    phase: "waiting-config",
    heartbeat: now.toISOString(),
    plans: {},
    stock: {},
    datacenterLabels: {},
    health: { status: "ok", since: now.toISOString(), failures: 0, attempts: 0, notified: false },
    failingNotifiers: {},
  };
}

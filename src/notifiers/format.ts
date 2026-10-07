import type { AppEvent, Notification, PlanInfo } from "../events.ts";
import { APP_NAME, APP_VERSION, REPO_URL } from "../shared/version.ts";

const OS_LABEL = { linux: "Linux", windows: "Windows" } as const;

export function eventEmoji(event: AppEvent): string {
  switch (event.kind) {
    case "stock":
      return event.status === "available" ? "🟢" : "🔴";
    case "orderability":
      return event.orderable ? "↩️" : "⚠️";
    case "health":
      return { degraded: "🛠️", recovered: "✅", halted: "⛔", "state-reset": "⚠️" }[event.status];
    case "notifier":
      return event.failing ? "⚠️" : "✅";
  }
}

export function planSummary(plan: PlanInfo): string {
  const specs = [plan.vCore !== null && `${plan.vCore} vCore`, plan.ramGb !== null && `${plan.ramGb} GB`, plan.price]
    .filter(Boolean)
    .join(", ");
  return `${plan.invoiceName} (${specs})`;
}

/** One line per event, without emoji: used in logs and as notification body lines. */
export function describeEvent(event: AppEvent): string {
  switch (event.kind) {
    case "stock": {
      const what = event.status === "available" ? "available" : "out of stock";
      return `${planSummary(event.plan)} ${what} in ${event.datacenter.label} (${OS_LABEL[event.os]})`;
    }
    case "orderability":
      return event.orderable
        ? `${planSummary(event.plan)} can be ordered again`
        : `${event.plan.invoiceName} is no longer available for purchase (withdrawn from the OVH catalog)`;
    case "health":
      return {
        degraded: `Monitoring degraded: ${event.detail}`,
        recovered: `Monitoring recovered: ${event.detail}`,
        "state-reset": `state.json was corrupted and has been reset: ${event.detail}`,
        halted:
          `Monitoring stopped: OVH changed the data this version relies on (${event.detail}). ` +
          `Wait for a new version and check ${REPO_URL} (running ${APP_VERSION})`,
      }[event.status];
    case "notifier":
      return event.failing
        ? `Notifier "${event.name}" is failing: ${event.error}`
        : `Notifier "${event.name}" is working again`;
  }
}

/** Events sorted by importance: app problems first, then purchases, then stock. */
export function sortEvents(events: readonly AppEvent[]): AppEvent[] {
  const rank = (e: AppEvent) =>
    e.kind === "health" ? 0 : e.kind === "notifier" ? 1 : e.kind === "orderability" ? 2 : e.status === "available" ? 3 : 4;
  return [...events].sort((a, b) => rank(a) - rank(b));
}

/** "🟢 VPS-2 2027 available in Milano (IT)" for one event, "🟢 OVH VPS: 3 changes" for more. */
export function notificationTitle(notification: Notification): string {
  const events = sortEvents(notification.events);
  const first = events[0]!;
  const prefix = notification.test ? "[TEST] " : "";
  if (first.kind === "health" && first.status === "halted") return `${prefix}⛔ ${APP_NAME} stopped`;
  if (events.length === 1) {
    const short =
      first.kind === "stock"
        ? `${first.plan.invoiceName} ${first.status === "available" ? "available" : "out of stock"} in ${first.datacenter.label}`
        : first.kind === "orderability"
          ? `${first.plan.invoiceName} ${first.orderable ? "can be ordered again" : "withdrawn from sale"}`
          : APP_NAME;
    return `${prefix}${eventEmoji(first)} ${short}`;
  }
  return `${prefix}${eventEmoji(first)} OVH VPS: ${events.length} changes`;
}

/** Plain-text body: one line per event, then the order link if a plan event is included. */
export function notificationText(notification: Notification, maxLength = Infinity): string {
  const events = sortEvents(notification.events);
  const footer = events.some((e) => e.kind === "stock" || e.kind === "orderability")
    ? `\nOrder: ${notification.orderUrl}`
    : "";
  const lines: string[] = [];
  let length = footer.length;
  for (const [i, event] of events.entries()) {
    const line = `${eventEmoji(event)} ${describeEvent(event)}`;
    const more = `…and ${events.length - i} more`;
    if (length + line.length + 1 + more.length + 1 > maxLength) {
      lines.push(more);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n") + footer;
}

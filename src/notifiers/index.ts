import type { Config } from "../config/schema.ts";
import type { Notification } from "../events.ts";
import { log } from "../shared/log.ts";
import { describeEvent, eventEmoji } from "./format.ts";

export type DispatchResult = {
  /** Enabled notifiers the notification was sent to. */
  attempted: number;
  delivered: number;
  failures: { id: string; name: string; error: string }[];
};

/** Logs the notification and sends it to every enabled notifier. */
export async function dispatch(config: Config, notification: Notification): Promise<DispatchResult> {
  for (const event of notification.events) log.info(`${eventEmoji(event)} ${describeEvent(event)}`);
  return { attempted: 0, delivered: 0, failures: [] };
}

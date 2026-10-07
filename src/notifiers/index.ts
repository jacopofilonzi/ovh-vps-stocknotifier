import type { Config, NotifierConfig, NotifierType } from "../config/schema.ts";
import type { Notification } from "../events.ts";
import { log } from "../shared/log.ts";
import * as discord from "./discord.ts";
import { describeEvent, eventEmoji } from "./format.ts";
import * as gotify from "./gotify.ts";
import * as ntfy from "./ntfy.ts";
import * as telegram from "./telegram.ts";
import * as webhook from "./webhook.ts";

type NotifierModule<T extends NotifierType> = {
  label: string;
  send: (config: Extract<NotifierConfig, { type: T }>, notification: Notification) => Promise<void>;
  summary: (config: Extract<NotifierConfig, { type: T }>) => string;
};

/** To add a notifier: create its module, add its schema in config/schema.ts and register it here. */
export const NOTIFIERS: { [T in NotifierType]: NotifierModule<T> } = {
  telegram: { label: "Telegram", ...telegram },
  discord: { label: "Discord", ...discord },
  webhook: { label: "Custom webhook", ...webhook },
  gotify: { label: "Gotify", ...gotify },
  ntfy: { label: "ntfy", ...ntfy },
};

export function sendWith(notifier: NotifierConfig, notification: Notification): Promise<void> {
  const module = NOTIFIERS[notifier.type] as NotifierModule<NotifierType>;
  return module.send(notifier as never, notification);
}

export function summarize(notifier: NotifierConfig): string {
  const module = NOTIFIERS[notifier.type] as NotifierModule<NotifierType>;
  return module.summary(notifier as never);
}

export type DispatchResult = {
  /** Notifiers the notification was sent to. */
  attempted: number;
  delivered: string[];
  failures: { id: string; name: string; error: string }[];
};

/** Logs the notification and sends it to every enabled notifier (or the ones in `only`), in parallel. */
export async function dispatch(
  config: Config,
  notification: Notification,
  only?: ReadonlySet<string>,
): Promise<DispatchResult> {
  if (!only) for (const event of notification.events) log.info(`${eventEmoji(event)} ${describeEvent(event)}`);
  const targets = config.notifiers.filter((n) => n.enabled && (!only || only.has(n.id)));
  const results = await Promise.allSettled(targets.map((n) => sendWith(n, notification)));
  const result: DispatchResult = { attempted: targets.length, delivered: [], failures: [] };
  results.forEach((r, i) => {
    const { id, name } = targets[i]!;
    if (r.status === "fulfilled") {
      result.delivered.push(id);
    } else {
      const error = (r.reason as Error).message;
      log.warn(`notifier "${name}" failed: ${error}`);
      result.failures.push({ id, name, error });
    }
  });
  return result;
}

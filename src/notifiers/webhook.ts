import type { z } from "zod";
import type { webhookSchema } from "../config/schema.ts";
import type { Notification } from "../events.ts";
import { APP_VERSION } from "../shared/version.ts";
import { describeEvent, notificationText, notificationTitle, sortEvents } from "./format.ts";
import { sendJson } from "./http.ts";

type WebhookConfig = z.infer<typeof webhookSchema>;

/**
 * JSON body sent to custom webhooks. `events` are the raw events (see src/events.ts),
 * each with a ready-made `message`; `title` and `text` are the same as other notifiers.
 */
export function webhookBody(notification: Notification) {
  return {
    title: notificationTitle(notification),
    text: notificationText(notification),
    test: notification.test ?? false,
    subsidiary: notification.subsidiary,
    orderUrl: notification.orderUrl,
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    events: sortEvents(notification.events).map((event) => ({ ...event, message: describeEvent(event) })),
  };
}

export async function send(config: WebhookConfig, notification: Notification) {
  await sendJson(config.url, webhookBody(notification), { method: config.method, headers: config.headers });
}

export const summary = (config: WebhookConfig) => `${config.method} ${new URL(config.url).host}`;

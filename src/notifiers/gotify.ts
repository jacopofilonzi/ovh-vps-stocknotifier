import type { z } from "zod";
import type { gotifySchema } from "../config/schema.ts";
import type { Notification } from "../events.ts";
import { notificationText, notificationTitle } from "./format.ts";
import { sendJson, withTrailingSlash } from "./http.ts";

type GotifyConfig = z.infer<typeof gotifySchema>;

export async function send(config: GotifyConfig, notification: Notification) {
  await sendJson(
    new URL("message", withTrailingSlash(config.serverUrl)).href,
    {
      title: notificationTitle(notification),
      message: notificationText(notification),
      priority: config.priority,
      extras: { "client::notification": { click: { url: notification.orderUrl } } },
    },
    { headers: { "X-Gotify-Key": config.token } },
  );
}

export const summary = (config: GotifyConfig) => new URL(config.serverUrl).host;

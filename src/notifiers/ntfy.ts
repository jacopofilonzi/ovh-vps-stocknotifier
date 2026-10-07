import type { z } from "zod";
import type { ntfySchema } from "../config/schema.ts";
import type { Notification } from "../events.ts";
import { notificationText, notificationTitle } from "./format.ts";
import { sendJson, withTrailingSlash } from "./http.ts";

type NtfyConfig = z.infer<typeof ntfySchema>;

export async function send(config: NtfyConfig, notification: Notification) {
  // JSON publishing (POST to the server root) avoids encoding the UTF-8 title in a header.
  await sendJson(
    withTrailingSlash(config.serverUrl),
    {
      topic: config.topic,
      title: notificationTitle(notification),
      message: notificationText(notification),
      priority: config.priority,
      click: notification.orderUrl,
    },
    { headers: config.token ? { Authorization: `Bearer ${config.token}` } : {} },
  );
}

export const summary = (config: NtfyConfig) => `${new URL(config.serverUrl).host}/${config.topic}`;

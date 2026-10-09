import type { z } from "zod";
import type { discordSchema } from "../config/schema.ts";
import type { AppEvent, Notification } from "../events.ts";
import { APP_NAME, APP_VERSION, REPO_URL } from "../shared/version.ts";
import { describeEvent, eventEmoji, notificationTitle, sortEvents } from "./format.ts";
import { mask, sendJson } from "./http.ts";

type DiscordConfig = z.infer<typeof discordSchema>;

/** Discord accepts at most 10 embeds per message. */
const MAX_EMBEDS = 10;

const COLORS = {
  available: 0x2ecc71,
  outOfStock: 0xe74c3c,
  withdrawn: 0xe67e22,
  orderable: 0x3498db,
  problem: 0x95a5a6,
  halted: 0xc0392b,
};

type Embed = {
  title: string;
  description?: string;
  url?: string;
  color: number;
  fields?: { name: string; value: string; inline: boolean }[];
};

export async function send(config: DiscordConfig, notification: Notification) {
  const events = sortEvents(notification.events);
  const fits = events.length <= MAX_EMBEDS ? events : events.slice(0, MAX_EMBEDS - 1);
  const embeds = fits.map((event) => toEmbed(event, notification));
  if (fits.length < events.length) {
    const rest = events.slice(fits.length);
    embeds.push({
      title: `…and ${rest.length} more`,
      description: rest.map((e) => `${eventEmoji(e)} ${describeEvent(e)}`).join("\n").slice(0, 4000),
      color: COLORS.problem,
    });
  }
  await sendJson(config.webhookUrl, {
    username: APP_NAME,
    content: notification.test ? notificationTitle(notification) : undefined,
    embeds,
    allowed_mentions: { parse: [] },
  });
}

function toEmbed(event: AppEvent, notification: Notification): Embed {
  const title = `${eventEmoji(event)} ${describeEvent(event)}`.slice(0, 256);
  switch (event.kind) {
    case "stock":
      return {
        title: `${eventEmoji(event)} ${event.plan.invoiceName} ${event.status === "available" ? "available" : "out of stock"}`,
        url: notification.orderUrl,
        color: event.status === "available" ? COLORS.available : COLORS.outOfStock,
        fields: [
          { name: "Datacenter", value: event.datacenter.label, inline: true },
          { name: "OS", value: event.os === "linux" ? "Linux" : "Windows", inline: true },
          { name: "Price/month", value: event.plan.price, inline: true },
          { name: "vCore", value: String(event.plan.vCore ?? "n/a"), inline: true },
          { name: "RAM", value: event.plan.ramGb !== null ? `${event.plan.ramGb} GB` : "n/a", inline: true },
          { name: "Plan code", value: event.plan.planCode, inline: true },
        ],
      };
    case "orderability":
      return {
        title: `${eventEmoji(event)} ${event.plan.invoiceName} ${event.orderable ? "can be ordered again" : "withdrawn from sale"}`,
        description: describeEvent(event),
        url: notification.orderUrl,
        color: event.orderable ? COLORS.orderable : COLORS.withdrawn,
      };
    case "health":
      if (event.status === "halted") {
        return {
          title: `⛔ ${APP_NAME} stopped`,
          description:
            `OVH changed the data this version relies on:\n\`${event.detail}\`\n\n` +
            `Monitoring is paused. Wait for a new version and check ${REPO_URL}`,
          url: REPO_URL,
          color: COLORS.halted,
          fields: [{ name: "Running version", value: APP_VERSION, inline: true }],
        };
      }
      return { title, color: event.status === "recovered" ? COLORS.available : COLORS.problem };
    case "notifier":
      return { title, color: event.failing ? COLORS.withdrawn : COLORS.available };
    case "test":
      return { title, color: COLORS.orderable };
  }
}

export const summary = (config: DiscordConfig) => `webhook ${mask(config.webhookUrl)}`;

import type { z } from "zod";
import type { telegramSchema } from "../config/schema.ts";
import type { Notification } from "../events.ts";
import { notificationText, notificationTitle } from "./format.ts";
import { sendJson } from "./http.ts";

type TelegramConfig = z.infer<typeof telegramSchema>;

const MAX_MESSAGE_LENGTH = 4096;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function send(config: TelegramConfig, notification: Notification) {
  const title = notificationTitle(notification);
  // Escaping can only grow the text: leave some room for it.
  const text = notificationText(notification, MAX_MESSAGE_LENGTH - title.length - 200);
  await sendJson(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    chat_id: config.chatId,
    text: `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(text)}`,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export const summary = (config: TelegramConfig) => `chat ${config.chatId}`;

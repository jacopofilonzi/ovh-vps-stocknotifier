import { input, number, password, select } from "@inquirer/prompts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { notifierSchema, type Config, type NotifierConfig, type NotifierType } from "../config/schema.ts";
import { NOTIFIERS } from "../notifiers/index.ts";
import { mask } from "../notifiers/http.ts";
import { ask, BACK, dim, type Back } from "./prompt.ts";

/** Asks every field of a notifier of `type`; `existing` pre-fills them when editing. */
export async function notifierForm(
  config: Config,
  type: NotifierType,
  existing?: NotifierConfig,
): Promise<NotifierConfig | Back> {
  const fields = await askFields(type, existing);
  if (fields === BACK) return BACK;
  const name = await text("Name", existing?.name ?? uniqueName(config, NOTIFIERS[type].label));
  if (name === BACK) return BACK;
  return notifierSchema.parse({
    id: existing?.id ?? randomUUID().slice(0, 8),
    name,
    enabled: existing?.enabled ?? true,
    type,
    ...fields,
  });
}

async function askFields(type: NotifierType, existing?: NotifierConfig): Promise<Record<string, unknown> | Back> {
  const old = existing?.type === type ? (existing as Record<string, unknown>) : {};
  const str = (key: string) => (typeof old[key] === "string" ? (old[key] as string) : undefined);

  switch (type) {
    case "telegram": {
      const botToken = await secret("Bot token (from @BotFather)", str("botToken"));
      if (botToken === BACK) return BACK;
      const chatId = await text("Chat id", str("chatId"));
      if (chatId === BACK) return BACK;
      return { botToken, chatId };
    }
    case "discord": {
      const webhookUrl = await url("Webhook URL", str("webhookUrl"));
      return webhookUrl === BACK ? BACK : { webhookUrl };
    }
    case "webhook": {
      const target = await url("URL", str("url"));
      if (target === BACK) return BACK;
      const method = await ask(select<"POST" | "PUT">, {
        message: "Method",
        choices: [{ value: "POST" }, { value: "PUT" }],
        default: str("method") as "POST" | "PUT" | undefined,
      });
      if (method === BACK) return BACK;
      const headers = await editHeaders((old.headers as Record<string, string> | undefined) ?? {});
      if (headers === BACK) return BACK;
      return { url: target, method, headers };
    }
    case "gotify": {
      const serverUrl = await url("Server URL", str("serverUrl"));
      if (serverUrl === BACK) return BACK;
      const token = await secret("Application token", str("token"));
      if (token === BACK) return BACK;
      const priority = await integer("Priority (0-10)", (old.priority as number | undefined) ?? 5, 0, 10);
      if (priority === BACK) return BACK;
      return { serverUrl, token, priority };
    }
    case "ntfy": {
      const serverUrl = await url("Server URL", str("serverUrl") ?? "https://ntfy.sh");
      if (serverUrl === BACK) return BACK;
      const topic = await text("Topic", str("topic"));
      if (topic === BACK) return BACK;
      const token = await secret("Access token (optional)", str("token"), true);
      if (token === BACK) return BACK;
      const priority = await integer("Priority (1-5)", (old.priority as number | undefined) ?? 4, 1, 5);
      if (priority === BACK) return BACK;
      return { serverUrl, topic, token: token || undefined, priority };
    }
  }
}

function text(message: string, current?: string): Promise<string | Back> {
  return ask(input, {
    message,
    default: current,
    validate: (value: string) => value.trim().length > 0 || "Required",
    transformer: (value: string) => value.trim(),
  }).then((v) => (v === BACK ? v : v.trim()));
}

function url(message: string, current?: string): Promise<string | Back> {
  return ask(input, {
    message,
    default: current,
    validate: (value: string) =>
      z.url({ protocol: /^https?$/ }).safeParse(value.trim()).success || "Enter an http(s) URL",
  }).then((v) => (v === BACK ? v : v.trim()));
}

/** Hidden input; when editing, an empty answer keeps the current value. */
async function secret(message: string, current?: string, optional = false): Promise<string | Back> {
  const hint = current ? dim(` (Enter keeps ${mask(current)})`) : optional ? dim(" (Enter for none)") : "";
  const value = await ask(password, {
    message: message + hint,
    mask: "•",
    validate: (v: string) => v.length > 0 || current !== undefined || optional || "Required",
  });
  if (value === BACK) return BACK;
  return value || current || "";
}

function integer(message: string, current: number, min: number, max: number): Promise<number | Back> {
  return ask(number, { message, default: current, min, max, required: true }).then((v) => v ?? current);
}

async function editHeaders(headers: Record<string, string>): Promise<Record<string, string> | Back> {
  const result = { ...headers };
  while (true) {
    const action = await ask(select<string>, {
      message: "Headers",
      choices: [
        ...Object.keys(result).map((name) => ({ name: `Remove ${name}: ${mask(result[name]!)}`, value: `remove:${name}` })),
        { name: "+ Add header", value: "add" },
        { name: "Done", value: "done" },
      ],
      default: "done",
    });
    if (action === BACK) return BACK;
    if (action === "done") return result;
    if (action.startsWith("remove:")) {
      delete result[action.slice("remove:".length)];
      continue;
    }
    const name = await text("Header name (e.g. Authorization)");
    if (name === BACK) continue;
    const value = await text("Header value");
    if (value === BACK) continue;
    result[name] = value;
  }
}

function uniqueName(config: Config, base: string): string {
  const taken = new Set(config.notifiers.map((n) => n.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

import { z } from "zod";
import { SUBSIDIARIES } from "../ovh/subsidiaries.ts";

/** Bump when the config shape changes, and add a migration in store.ts. */
export const CONFIG_SCHEMA_VERSION = 1;

export const MIN_INTERVAL_SECONDS = 60;

const notifierBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
};

const httpUrl = z.url({ protocol: /^https?$/ });

export const telegramSchema = z.object({
  ...notifierBase,
  type: z.literal("telegram"),
  botToken: z.string().min(1),
  chatId: z.string().min(1),
});

export const discordSchema = z.object({
  ...notifierBase,
  type: z.literal("discord"),
  webhookUrl: httpUrl,
});

export const webhookSchema = z.object({
  ...notifierBase,
  type: z.literal("webhook"),
  url: httpUrl,
  method: z.enum(["POST", "PUT"]),
  headers: z.record(z.string(), z.string()),
});

export const gotifySchema = z.object({
  ...notifierBase,
  type: z.literal("gotify"),
  serverUrl: httpUrl,
  token: z.string().min(1),
  priority: z.int().min(0).max(10),
});

export const ntfySchema = z.object({
  ...notifierBase,
  type: z.literal("ntfy"),
  serverUrl: httpUrl,
  topic: z.string().min(1),
  token: z.string().optional(),
  priority: z.int().min(1).max(5),
});

export const notifierSchema = z.discriminatedUnion("type", [
  telegramSchema,
  discordSchema,
  webhookSchema,
  gotifySchema,
  ntfySchema,
]);

export const configSchema = z.object({
  configSchemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
  subsidiary: z.enum(SUBSIDIARIES.map((s) => s.code) as [string, ...string[]]),
  intervalSeconds: z.int().min(MIN_INTERVAL_SECONDS),
  os: z.array(z.enum(["linux", "windows"])).min(1),
  datacenters: z.array(z.string()),
  plans: z.array(z.string()),
  notifiers: z.array(notifierSchema),
});

export type Config = z.infer<typeof configSchema>;
export type NotifierConfig = z.infer<typeof notifierSchema>;
export type NotifierType = NotifierConfig["type"];

export function defaultConfig(): Config {
  return {
    configSchemaVersion: CONFIG_SCHEMA_VERSION,
    subsidiary: "IT",
    intervalSeconds: 300,
    os: ["linux"],
    datacenters: [],
    plans: [],
    notifiers: [],
  };
}

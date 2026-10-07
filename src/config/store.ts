import { stat } from "node:fs/promises";
import { describeIssue } from "../shared/http.ts";
import { readJsonFile, writeJsonFile } from "../shared/json-file.ts";
import { CONFIG_PATH } from "../shared/paths.ts";
import { CONFIG_SCHEMA_VERSION, configSchema, type Config } from "./schema.ts";

export type ConfigLoadResult =
  | { status: "missing" }
  | { status: "invalid"; error: string }
  | { status: "newer"; version: number }
  | { status: "ok"; config: Config };

/**
 * Upgrades a config from version N to N+1, keyed by N.
 * Migrations only run in memory: the file is rewritten the next time the TUI saves,
 * so the TUI stays the only process writing config.json.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export async function loadConfig(): Promise<ConfigLoadResult> {
  const file = await readJsonFile(CONFIG_PATH);
  if (file.status === "missing") return file;
  if (file.status === "unparsable") return { status: "invalid", error: `not valid JSON: ${file.error}` };

  let raw = file.data as Record<string, unknown>;
  let version = typeof raw?.configSchemaVersion === "number" ? raw.configSchemaVersion : 0;
  if (version > CONFIG_SCHEMA_VERSION) return { status: "newer", version };
  while (version < CONFIG_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return { status: "invalid", error: `unsupported configSchemaVersion ${version}` };
    raw = { ...migrate(raw), configSchemaVersion: ++version };
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", error: describeIssue(parsed.error) };
  return { status: "ok", config: parsed.data };
}

export async function saveConfig(config: Config) {
  await writeJsonFile(CONFIG_PATH, configSchema.parse(config));
}

/** Modification time of config.json, or 0 if it doesn't exist. */
export async function configMtime(): Promise<number> {
  try {
    return (await stat(CONFIG_PATH)).mtimeMs;
  } catch {
    return 0;
  }
}

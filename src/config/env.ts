import path from "node:path";

/**
 * Environment variables, read once at startup. Every variable read here is documented in
 * .env.example, and in docker-compose*.yaml when it matters for deployment.
 * TZ is not read here: Node applies it by itself (time zone of logs and notifications).
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const isLogLevel = (value: string): value is LogLevel => (LOG_LEVELS as readonly string[]).includes(value);

// Empty values count as unset: `DATA_DIR=` in .env shouldn't mean the current directory.
const rawLogLevel = process.env.LOG_LEVEL?.trim().toLowerCase() || "info";

export const env = {
  /** Directory of config.json and state.json: `/data` in Docker, `./temp` with make. */
  dataDir: path.resolve(process.env.DATA_DIR?.trim() || "./data"),
  logLevel: isLogLevel(rawLogLevel) ? rawLogLevel : "info",
  /** The LOG_LEVEL value when it isn't a known level (`info` is used instead): the scraper warns about it. */
  invalidLogLevel: isLogLevel(rawLogLevel) ? undefined : process.env.LOG_LEVEL,
} as const;

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const threshold = LEVELS[configured as Level] ?? LEVELS.info;

function write(level: Level, message: string, ...details: unknown[]) {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toLocaleString("sv-SE"); // "2026-10-07 11:40:00", local time zone (TZ)
  const line = `${time} ${level.toUpperCase().padEnd(5)} ${message}`;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(line, ...details);
}

export const log = {
  debug: (message: string, ...details: unknown[]) => write("debug", message, ...details),
  info: (message: string, ...details: unknown[]) => write("info", message, ...details),
  warn: (message: string, ...details: unknown[]) => write("warn", message, ...details),
  error: (message: string, ...details: unknown[]) => write("error", message, ...details),
};

const lastOnce = new Map<string, string>();

/**
 * Logs `message` only if it differs from the last message logged under `key`.
 * Used for conditions that persist across ticks (waiting for config, invalid config, ...).
 */
export function logOnce(key: string, level: Level, message: string) {
  if (lastOnce.get(key) === message) return;
  lastOnce.set(key, message);
  write(level, message);
}

/** Forgets `key`, so the next `logOnce` with that key is logged again. */
export function resetLogOnce(key: string) {
  lastOnce.delete(key);
}

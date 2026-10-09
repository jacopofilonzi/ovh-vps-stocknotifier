import { checkbox, number } from "@inquirer/prompts";
import { MIN_INTERVAL_SECONDS, type Config } from "../config/schema.ts";
import { OS_LABEL, type OperatingSystem } from "../ovh/availability.ts";
import { ask, BACK, dim, type Back } from "./prompt.ts";

export async function editSystems(config: Config): Promise<Config | Back> {
  const os = await ask(checkbox<OperatingSystem>, {
    message: "Operating systems to watch (OVH tracks their stock separately)",
    choices: [
      { name: OS_LABEL.linux, value: "linux", checked: config.os.includes("linux"), description: "Linux distributions and Linux-based panels" },
      { name: OS_LABEL.windows, value: "windows", checked: config.os.includes("windows"), description: "Windows Server (paid license option)" },
    ],
    required: true,
  });
  if (os === BACK) return BACK;
  return { ...config, os };
}

export async function editInterval(config: Config): Promise<Config | Back> {
  const minutes = await ask(number, {
    message: `Check interval, in minutes ${dim("(under 5 may get you rate-limited by OVH)")}`,
    default: config.intervalSeconds / 60,
    min: MIN_INTERVAL_SECONDS / 60,
    max: 24 * 60,
    step: "any" as const,
    required: true,
  });
  if (typeof minutes !== "number") return BACK;
  return { ...config, intervalSeconds: Math.round(minutes * 60) };
}

export function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${(seconds / 60).toFixed(1)} min`;
}

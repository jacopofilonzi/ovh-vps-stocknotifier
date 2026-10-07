import { runCheckNow } from "./check-now.ts";
import { runHealthcheck } from "./healthcheck.ts";
import { runScraper } from "./scraper/index.ts";
import { runSmoke } from "./smoke.ts";
import { runStatus } from "./status.ts";
import { runTui } from "./tui/index.ts";
import { APP_NAME, APP_VERSION } from "./shared/version.ts";

const COMMANDS: Record<string, { description: string; run: () => Promise<number> }> = {
  scraper: { description: "run the scraper (--once: run a single check and exit)", run: () => runScraper({ once: process.argv.includes("--once") }) },
  tui: { description: "configure the scraper interactively", run: runTui },
  "check-now": { description: "ask the running scraper for an immediate check", run: runCheckNow },
  status: { description: "print the stored stock status", run: runStatus },
  healthcheck: { description: "exit 0 if the scraper is healthy (Docker HEALTHCHECK)", run: runHealthcheck },
  smoke: { description: "check the live OVH APIs still match this version", run: runSmoke },
};

const [command = "help"] = process.argv.slice(2);
const entry = COMMANDS[command];

if (!entry) {
  console.log(`${APP_NAME} ${APP_VERSION}\n\nUsage: node src/main.ts <command>\n`);
  for (const [name, { description }] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(12)} ${description}`);
  process.exit(command === "help" ? 0 : 1);
}
// Exit explicitly: open HTTP keep-alive sockets would otherwise delay it.
process.exit(await entry.run());

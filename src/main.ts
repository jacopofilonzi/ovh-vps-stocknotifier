import { runSmoke } from "./smoke.ts";
import { APP_NAME, APP_VERSION } from "./shared/version.ts";

const COMMANDS: Record<string, { description: string; run: () => Promise<number> }> = {
  smoke: { description: "check the live OVH APIs still match this version", run: runSmoke },
};

const [command = "help"] = process.argv.slice(2);
const entry = COMMANDS[command];

if (!entry) {
  console.log(`${APP_NAME} ${APP_VERSION}\n\nUsage: node src/main.ts <command>\n`);
  for (const [name, { description }] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(12)} ${description}`);
  process.exitCode = command === "help" ? 0 : 1;
} else {
  process.exitCode = await entry.run();
}

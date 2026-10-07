import { ExitPromptError } from "@inquirer/core";
import { select } from "@inquirer/prompts";
import { defaultConfig, type Config } from "../config/schema.ts";
import { loadConfig } from "../config/store.ts";
import { CONFIG_PATH } from "../shared/paths.ts";
import { APP_NAME } from "../shared/version.ts";
import { runMenu } from "./menu.ts";
import { ask, bold, red } from "./prompt.ts";
import { runWizard } from "./wizard.ts";

export async function runTui(): Promise<number> {
  if (!process.stdin.isTTY) {
    console.error("The TUI needs an interactive terminal: with Docker, use `docker compose run --rm notifier tui`.");
    return 1;
  }
  try {
    const config = await initialConfig();
    if (config) await runMenu(config);
    return 0;
  } catch (err) {
    if (err instanceof ExitPromptError) return 0; // Ctrl+C
    throw err;
  }
}

/** The config to open the menu with; runs the wizard when there's none. Null means quit. */
async function initialConfig(): Promise<Config | null> {
  const loaded = await loadConfig();
  switch (loaded.status) {
    case "ok":
      return loaded.config;
    case "missing":
      console.log(`${bold(`Welcome to ${APP_NAME}`)}\nNo configuration yet: let's create one.\n`);
      return runWizard(defaultConfig());
    case "newer":
      console.error(red(`${CONFIG_PATH} was written by a newer version (configSchemaVersion ${loaded.version}): update this one.`));
      return null;
    case "invalid": {
      console.log(red(`${CONFIG_PATH} is invalid: ${loaded.error}`));
      const action = await ask(select<string>, {
        message: "What now?",
        choices: [
          { name: "Run the setup from scratch (replaces config.json when saved)", value: "wizard" },
          { name: "Quit, I'll fix it by hand", value: "quit" },
        ],
      });
      return action === "wizard" ? runWizard(defaultConfig()) : null;
    }
  }
}

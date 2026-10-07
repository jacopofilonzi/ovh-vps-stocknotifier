import { confirm, select } from "@inquirer/prompts";
import type { Config } from "../config/schema.ts";
import type { Catalog } from "../ovh/catalog.ts";
import { saveConfig } from "../config/store.ts";
import { getCatalog } from "./catalog.ts";
import { editDatacenters, editSubsidiary } from "./location.ts";
import { editNotifiers } from "./notifiers.ts";
import { editInterval, editSystems } from "./options.ts";
import { editPlans } from "./plans.ts";
import { ask, BACK, bold, clearScreen, dim, type Back } from "./prompt.ts";
import { summaryLines } from "./summary.ts";

type Step = { title: string; run: (config: Config) => Promise<Config | Back> };

const withCatalog =
  (edit: (config: Config, catalog: Catalog) => Promise<Config | Back>) =>
  async (config: Config) => {
    const catalog = await getCatalog(config.subsidiary);
    return catalog === BACK ? BACK : edit(config, catalog);
  };

const STEPS: Step[] = [
  { title: "Subsidiary", run: editSubsidiary },
  { title: "Datacenters", run: withCatalog(editDatacenters) },
  { title: "Operating systems", run: editSystems },
  { title: "Plans", run: withCatalog(editPlans) },
  { title: "Notifiers", run: (config) => editNotifiers(config, async (c) => c, { wizard: true }) },
  { title: "Check interval", run: editInterval },
];

/**
 * Guided setup. Esc goes back one step. config.json is written only at the end, after
 * confirming, so the scraper never starts from a half-done configuration.
 * Returns the saved config, or null if the user left without saving.
 */
export async function runWizard(initial: Config): Promise<Config | null> {
  let config = initial;
  let step = 0;
  while (true) {
    while (step < STEPS.length) {
      const { title, run } = STEPS[step]!;
      clearScreen();
      console.log(`${bold(`Setup [${step + 1}/${STEPS.length}] ${title}`)}  ${dim("Esc: previous step · Ctrl+C: quit without saving")}\n`);
      const result = await run(config);
      if (result !== BACK) {
        config = result;
        step++;
      } else if (step > 0) {
        step--;
      } else if ((await ask(confirm, { message: "Leave the setup without saving?", default: false })) === true) {
        return null;
      }
    }

    clearScreen();
    const catalog = await getCatalog(config.subsidiary);
    console.log(summaryLines(config, catalog === BACK ? null : catalog).join("\n"));
    const action = await ask(select<string>, {
      message: "Save this configuration?",
      choices: [
        { name: "Save", value: "save" },
        { name: "Go back and change something", value: "back" },
        { name: "Quit without saving", value: "quit" },
      ],
    });
    if (action === "save") {
      await saveConfig(config);
      return config;
    }
    if (action === "quit") return null;
    step = STEPS.length - 1;
  }
}

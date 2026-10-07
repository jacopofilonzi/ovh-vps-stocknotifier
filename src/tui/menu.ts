import { select, Separator } from "@inquirer/prompts";
import type { Config } from "../config/schema.ts";
import { saveConfig } from "../config/store.ts";
import type { Catalog } from "../ovh/catalog.ts";
import { peekState } from "../state/store.ts";
import { statusLines } from "../status.ts";
import { getCatalog } from "./catalog.ts";
import { editDatacenters, editSubsidiary } from "./location.ts";
import { editNotifiers } from "./notifiers.ts";
import { editInterval, editSystems } from "./options.ts";
import { editPlans } from "./plans.ts";
import { ask, BACK, clearScreen, dim, green, pause, type Back } from "./prompt.ts";
import { describe, summaryLines } from "./summary.ts";
import { runWizard } from "./wizard.ts";

/** Settings menu: every confirmed change is saved right away; the scraper picks it up within seconds. */
export async function runMenu(initial: Config) {
  let config = initial;
  let notice = "";
  const save = async (next: Config) => {
    await saveConfig(next);
    notice = green("✓ Saved");
    return next;
  };
  const withCatalog = async (edit: (config: Config, catalog: Catalog) => Promise<Config | Back>) => {
    const catalog = await getCatalog(config.subsidiary);
    return catalog === BACK ? BACK : edit(config, catalog);
  };

  while (true) {
    const state = await peekState();
    const catalog = await getCatalog(config.subsidiary);
    const current = catalog === BACK ? null : catalog;
    const d = describe(config, current, state);
    clearScreen();
    console.log(summaryLines(config, current, state).join("\n"));
    if (notice) console.log(notice + "\n");
    notice = "";

    const value = (text: string) => dim(text.length > 60 ? `${text.slice(0, 57)}…` : text);
    const action = await ask(select<string>, {
      message: "What do you want to do?",
      choices: [
        { name: `Subsidiary          ${value(d.subsidiary)}`, value: "subsidiary" },
        { name: `Datacenters         ${value(d.datacenters)}`, value: "datacenters" },
        { name: `Operating systems   ${value(d.os)}`, value: "os" },
        { name: `Plans               ${value(d.plans)}`, value: "plans" },
        { name: `Notifiers           ${value(d.notifiers)}`, value: "notifiers" },
        { name: `Check interval      ${value(d.interval)}`, value: "interval" },
        new Separator(),
        { name: "Status", value: "status" },
        { name: "Run the setup wizard again", value: "wizard" },
        { name: "Exit", value: "exit" },
      ],
      pageSize: 12,
    });

    let next: Config | Back = BACK;
    switch (action) {
      case BACK:
      case "exit":
        return;
      case "subsidiary":
        next = await editSubsidiary(config);
        break;
      case "datacenters":
        next = await withCatalog(editDatacenters);
        break;
      case "os":
        next = await editSystems(config);
        break;
      case "plans":
        next = await withCatalog(editPlans);
        break;
      case "interval":
        next = await editInterval(config);
        break;
      case "notifiers":
        clearScreen();
        config = (await editNotifiers(config, async (c) => (config = await save(c)), { state })) as Config;
        break;
      case "status":
        clearScreen();
        await pause(await statusLines());
        break;
      case "wizard":
        config = (await runWizard(config)) ?? config;
        break;
    }
    if (next !== BACK) config = await save(next);
  }
}

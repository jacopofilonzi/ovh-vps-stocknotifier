import { confirm, select, Separator } from "@inquirer/prompts";
import type { Config, NotifierConfig, NotifierType } from "../config/schema.ts";
import { NOTIFIERS, summarize } from "../notifiers/index.ts";
import type { State } from "../state/schema.ts";
import { getCatalog } from "./catalog.ts";
import { notifierForm } from "./notifier-forms.ts";
import { sendLivePreview, sendTest } from "./preview.ts";
import { ask, BACK, dim, green, red, yellow, type Back } from "./prompt.ts";

type Commit = (config: Config) => Promise<Config>;

/**
 * Notifier list. Every change goes through `commit` (which saves in the menu, and does nothing
 * in the wizard). Returns the final config, or BACK when Esc is pressed in the wizard.
 */
export async function editNotifiers(
  initial: Config,
  commit: Commit,
  { wizard = false, state = null as State | null } = {},
): Promise<Config | Back> {
  let config = initial;
  while (true) {
    const enabled = config.notifiers.filter((n) => n.enabled);
    const action = await ask(select<string>, {
      message: wizard ? "Notifiers (you can add them later too)" : "Notifiers",
      choices: [
        ...config.notifiers.map((n) => ({ name: notifierLine(n, state), value: `edit:${n.id}` })),
        new Separator(),
        { name: "+ Add notifier", value: "add" },
        ...(enabled.length > 0
          ? [
              { name: "Send a test notification to all enabled", value: "test-all" },
              { name: "Send a preview with live data to all enabled", value: "preview-all" },
            ]
          : []),
        { name: wizard ? "Continue →" : "← Back", value: "done" },
      ],
      default: config.notifiers.length === 0 ? "add" : undefined,
      pageSize: 15,
    });
    if (action === BACK) return wizard ? BACK : config;
    if (action === "done") return config;
    if (action === "add") {
      const added = await addNotifier(config);
      if (added !== BACK) config = await commit({ ...config, notifiers: [...config.notifiers, added] });
    } else if (action === "test-all") {
      await sendTest(config, enabled);
    } else if (action === "preview-all") {
      await preview(config, enabled);
    } else {
      const notifier = config.notifiers.find((n) => n.id === action.slice("edit:".length))!;
      config = await notifierMenu(config, notifier, commit);
    }
  }
}

function notifierLine(n: NotifierConfig, state: State | null): string {
  const failing = state?.failingNotifiers[n.id];
  const status = !n.enabled ? dim("✗ disabled") : failing ? yellow(`⚠️ failing: ${failing.error}`) : green("✓ enabled");
  return `${n.name} ${dim(`(${NOTIFIERS[n.type].label}, ${summarize(n)})`)}  ${status}`;
}

async function addNotifier(config: Config): Promise<NotifierConfig | Back> {
  const type = await ask(select<NotifierType>, {
    message: "Notifier type",
    choices: (Object.keys(NOTIFIERS) as NotifierType[]).map((t) => ({ name: NOTIFIERS[t].label, value: t })),
  });
  if (type === BACK) return BACK;
  let notifier = await notifierForm(config, type);
  // Offer a test, and a chance to fix the fields if it fails.
  while (notifier !== BACK) {
    const test = await ask(confirm, { message: "Send a test notification?", default: true });
    if (test !== true || (await sendTest(config, [notifier]))) return notifier;
    const next = await ask(select<string>, {
      message: "The test failed. What now?",
      choices: [
        { name: "Edit the fields", value: "edit" },
        { name: "Keep it anyway", value: "keep" },
        { name: "Discard it", value: "discard" },
      ],
    });
    if (next === "keep") return notifier;
    if (next !== "edit") return BACK;
    notifier = await notifierForm(config, type, notifier);
  }
  return BACK;
}

async function notifierMenu(config: Config, notifier: NotifierConfig, commit: Commit): Promise<Config> {
  const replace = (n: NotifierConfig | null) => ({
    ...config,
    notifiers: config.notifiers.flatMap((other) => (other.id === notifier.id ? (n ? [n] : []) : [other])),
  });
  while (true) {
    const action = await ask(select<string>, {
      message: `${notifier.name} ${dim(`(${NOTIFIERS[notifier.type].label})`)}`,
      choices: [
        { name: "Send a test notification", value: "test" },
        { name: "Send a preview with live data", value: "preview" },
        { name: "Edit", value: "edit" },
        { name: notifier.enabled ? "Disable" : "Enable", value: "toggle" },
        { name: red("Delete"), value: "delete" },
        { name: "← Back", value: "back" },
      ],
    });
    switch (action) {
      case BACK:
      case "back":
        return config;
      case "test":
        await sendTest(config, [notifier]);
        break;
      case "preview":
        await preview(config, [notifier]);
        break;
      case "edit": {
        const edited = await notifierForm(config, notifier.type, notifier);
        if (edited !== BACK) {
          config = await commit(replace(edited));
          notifier = edited;
        }
        break;
      }
      case "toggle":
        notifier = { ...notifier, enabled: !notifier.enabled };
        config = await commit(replace(notifier));
        break;
      case "delete":
        if ((await ask(confirm, { message: `Delete "${notifier.name}"?`, default: false })) === true) {
          return commit(replace(null));
        }
        break;
    }
  }
}

async function preview(config: Config, notifiers: NotifierConfig[]) {
  if (config.plans.length === 0) {
    console.log(yellow("Select some plans first."));
    return;
  }
  const catalog = await getCatalog(config.subsidiary);
  if (catalog !== BACK) await sendLivePreview(config, catalog, notifiers);
}

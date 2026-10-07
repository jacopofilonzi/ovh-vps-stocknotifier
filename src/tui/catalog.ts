import { select } from "@inquirer/prompts";
import { fetchCatalog, type Catalog } from "../ovh/catalog.ts";
import { ApiError } from "../shared/http.ts";
import { REPO_URL } from "../shared/version.ts";
import { ask, BACK, red, withSpinner, type Back } from "./prompt.ts";

const cache = new Map<string, Catalog>();

/**
 * Catalog of `subsidiary`, fetched once per TUI session.
 * On errors the user can retry or go back (BACK). An incompatible catalog can't be retried.
 */
export async function getCatalog(subsidiary: string): Promise<Catalog | Back> {
  const cached = cache.get(subsidiary);
  if (cached) return cached;
  while (true) {
    try {
      const catalog = await withSpinner(`Fetching the OVH catalog (${subsidiary})`, () => fetchCatalog(subsidiary));
      cache.set(subsidiary, catalog);
      return catalog;
    } catch (err) {
      if (err instanceof ApiError && err.kind === "incompatible") {
        console.log(red(incompatibleMessage(err)));
        await ask(select, { message: "", choices: [{ name: "← Back", value: "back" }] });
        return BACK;
      }
      console.log(red(`Couldn't fetch the OVH catalog: ${(err as Error).message}`));
      const choice = await ask(select, {
        message: "What now?",
        choices: [
          { name: "Retry", value: "retry" },
          { name: "← Back", value: "back" },
        ],
      });
      if (choice !== "retry") return BACK;
    }
  }
}

export function incompatibleMessage(err: ApiError): string {
  return (
    `OVH changed the data this version relies on: ${err.signature}\n` +
    `Plans and datacenters can't be configured until a new version is released: check ${REPO_URL}`
  );
}

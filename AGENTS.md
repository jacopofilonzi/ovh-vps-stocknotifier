# AGENTS.md

Guidelines for AI coding agents (and people) working in this repository.
What lives where and how the pieces fit together is in [STRUCTURE.md](STRUCTURE.md): read it first,
instead of re-reading the whole repo.

## What it is

OVH VPS Stock Notifier: watches the stock and orderability of OVHcloud VPS plans through OVH's public
order APIs and notifies Telegram, Discord, webhooks, Gotify or ntfy when something changes.
Stack: TypeScript run directly by Node 24 (no build step), zod 4, @inquirer/prompts 8, pnpm 10.
Targets: Linux server in Docker (`linux/amd64`, `linux/arm64`); local development on Windows, macOS, Linux.
Everything, UI included, is in English only.

## Workflow

- **Non-trivial changes start with a plan.** For a feature, refactor, new dependency or anything touching
  several files: read what you need, then present the plan (what changes, which files, trade-offs, open
  questions) and wait for my approval before editing. Small, obvious fixes can go straight in. If the plan
  changes significantly along the way, stop and ask again.
- When something is genuinely my decision (UX, user-visible naming, data formats, breaking changes), ask
  instead of guessing. Otherwise pick the sensible default and say what you picked.
- Run commands from the repo root through the Makefile (`make help` lists them). A new recurring command
  goes into the Makefile too.
- **While developing, use the dev tools** (`make dev`: the scraper restarts when `src/` changes; `make tui`)
  instead of building the Docker image after every change. Build and run the image (`make docker-up`) only
  when I say the dev tools don't pick up a specific change, and only for that check.
- **Always run `make check` before declaring work done.** It must pass with zero errors and zero warnings.
  If you couldn't run something (Docker, the live OVH APIs, a platform you're not on), say so instead of
  claiming it works.
- Makefile recipes must work in both `sh` and `cmd.exe` (GNU make on Windows falls back to `cmd.exe`): only
  `cd dir && command`, no inline `VAR=x cmd`, no `rm`/`cp`/`mkdir -p`; use `node -e` for file operations.
- Every new env var is read in `src/config/env.ts` **and** documented in `.env.example` (and in
  `docker-compose*.yaml` if relevant for deployment) and in the README. Never commit `.env` or secrets.

### Commits

- Small, step-by-step commits as the work progresses, never a single commit at the end. Conventional
  prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- **Exception, experiments:** while we're trying things out (styling, layouts, alternative approaches),
  don't commit. Commit only once I've picked the version to keep.
- Mockups and design alternatives are never committed: they only serve to choose; the chosen one lives in the code.
- Push, tag and release only when I ask.

### Keep the agent docs in sync, in the same change

`STRUCTURE.md` and this file exist so agents don't have to re-read the whole repo. When you add, move,
rename or delete a file or module, or change an env var, invariant, data format, OVH endpoint or workflow
command, update `STRUCTURE.md` / `AGENTS.md` (and `README.md` for user-facing changes) in the same commit
or right after. Before declaring work done, check that every path, name and value they mention for the
areas you touched still matches the code.

## Invariants — don't break these

- **One writer per file.** `config.json` is written only by the TUI, `state.json` only by the scraper,
  always through `writeJsonFile` (temp file + rename). Config migrations run in memory only, so the
  scraper never writes `config.json`.
- **Only the scraper checks for real** (notifies and saves). The TUI's previews and read-only checks never
  touch `state.json`; "Check now" asks the scraper through the `check-now` file instead of checking itself.
- **A failed request never becomes "out of stock".** Transient errors leave the affected stock untouched;
  an `incompatible` response discards the whole working copy of the state (see `scraper/index.ts`).
  `src/scraper/tick.test.ts` covers this: keep it passing, extend it when the tick changes.
- **No delivery, no state change.** If no notifier delivers a notification, plans and stock are rolled
  back so the same changes are notified on the next check.
- **Validate only what is used.** OVH schemas (`src/ovh/schemas.ts`) declare only the fields the app reads.
  "Critical" data (plan codes, orderability, datacenters, stock statuses) failing validation is an
  `incompatible` error, confirmed 3 times before the scraper halts; "display" data (names, specs, prices)
  falls back to the plan code or `n/a`. Never make a display field critical.
- **First sight is silent** for plans and stock keys, except a plan already available or already withdrawn.
- **Secrets** (bot tokens, webhook URLs, access tokens, header values) are never logged and are shown only
  through `mask()` (`src/notifiers/http.ts`).
- **Durable data stays compatible.** `config.json` is user data: a shape change bumps
  `CONFIG_SCHEMA_VERSION` and adds a migration in `src/config/store.ts`. `state.json` is rebuildable: a
  shape change bumps `STATE_SCHEMA_VERSION` and old files are discarded.

## Code

- Everything is written in English (code, comments, commits, docs, UI).
- Keep modules small and focused: one folder per area; split a file when it grows several responsibilities.
- Comments explain *why*, not *what*. Put the design of a non-trivial module in its top-level comment
  (upstream formats, invariants, data layout).
- Never ignore errors: wrap them with context. No unchecked `as` casts or `!` on external data (network,
  files, user input): validate it with zod first.
- Use the logger (`src/shared/log.ts`) in the scraper and the modules it uses, never `console.log`.
  Printing with `console` is fine in the TUI and in the CLI commands (`status`, `check-now`, `smoke`, `healthcheck`).
- No OS-specific code so far; if some is ever needed, isolate it in one place. Build paths with
  `path.join`, never by concatenating `/`.
- Reuse shared helpers instead of rewriting them: `fetchJson` (OVH), `sendJson` (notifiers),
  `fetchWatchedStock`, `mapSettled`, `formatColumns`.
- **Dependencies are recent majors whose APIs differ from most online examples:** check the docs for the
  installed version before using an API. Ask before adding a new dependency.
  - Node 24 runs `.ts` files by stripping types: only erasable syntax (`erasableSyntaxOnly`: no enums,
    namespaces or parameter properties), imports with the `.ts` extension.
  - TypeScript 7 (native `tsc`), used only for `make typecheck`.
  - zod 4: `z.url()`, `z.int()`, `z.iso.datetime()`, `.catch()`.
  - @inquirer/prompts 8: prompts take a context with `signal`; in the TUI always go through `ask()`
    (`src/tui/prompt.ts`), which turns Esc into `BACK`.
- Deleting user data means moving it aside, unless agreed otherwise (e.g. a corrupted `state.json` is
  renamed, not deleted).

## Testing

- Unit tests live next to the code (`*.test.ts`, `node --test`). Test parsing against fixtures copied from
  real responses, never live requests: `scripts/dataset.json` is a real IT catalog; stub `fetch` for the
  stock API (see `src/scraper/tick.test.ts`). Live checks are only in `make smoke`.
- No end-to-end setup. To try the scraper or the TUI by hand, use a scratch data directory
  (`make once DATA_DIR=...`): see Known pitfalls.

## Versions and releases

- Versions are `x.y.z`: `x` major (only when I decide), `y` feature, `z` fix. A feature bumps `y` and resets `z`.
- The version lives only in `package.json` (`APP_VERSION` reads it). The release tag `vX.Y.Z` must match
  it: CI refuses to publish otherwise.
- Tags and releases only when I ask.

## Adding a notifier

1. Add its config schema in `src/config/schema.ts` and to `notifierSchema`.
2. Create `src/notifiers/<type>.ts` exporting `send(config, notification)` and `summary(config)` (secrets
   through `mask()`), using `sendJson` and the texts of `format.ts`.
3. Register it in `NOTIFIERS` (`src/notifiers/index.ts`).
4. Add its fields to `askFields` in `src/tui/notifier-forms.ts` (secrets with `secret()`).
5. Add a sender test in `src/notifiers/notifiers.test.ts` (local HTTP server) and document it in the
   README's Notifiers table.

## Known pitfalls

- The main dev machine is Windows 11; shells are PowerShell and Git Bash. Commands and scripts must work there.
- **Git Bash rewrites env values that look like paths** (`DATA_DIR=/data` becomes `C:/Program Files/Git/data`):
  prefix the command with `MSYS2_ENV_CONV_EXCL='*'`, or set the value in `.env`.
- **`./temp` holds my real local configuration, with working notifiers.** `make once`, `make scraper` and
  `make dev` use it and hit the live OVH APIs: for experiments pass a scratch `DATA_DIR`.
- With make, `DATA_DIR` is always `./temp`: Node's `--env-file` never overrides variables already set,
  so a `DATA_DIR` in `.env` only applies outside make.
- If `pnpm install` aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` (e.g. `node_modules`
  installed from another platform), run `pnpm install --frozen-lockfile --config.confirmModulesPurge=false`.
  The same fixes `tsc` failing with "Unable to resolve @typescript/typescript-win32-x64".
- Files in `DATA_DIR` are polled (`watchFile`), not watched: filesystem events aren't delivered reliably
  on Docker Desktop bind mounts.
- OVH quirks that look like bugs but are deliberate: the CZ, FI and LT subsidiaries are left out (the API
  answers with the IE catalog); Local Zones have no metadata in the catalog, so their city comes from
  `LOCAL_ZONES` in `src/ovh/datacenters.ts`.

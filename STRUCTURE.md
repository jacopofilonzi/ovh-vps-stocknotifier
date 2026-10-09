# Project structure

OVH VPS Stock Notifier watches the stock and orderability of OVHcloud VPS plans through OVH's public
order APIs and notifies the configured channels when something changes. Two processes share a data
directory and never talk directly: the **scraper** (long-running, the only one that checks for real,
notifies and writes `state.json`) and the **TUI** (interactive configuration, writes `config.json`).
Node 24 runs the TypeScript sources directly: there is no build step.

```text
repo/
├── src/                     TypeScript (Node 24, zod 4, @inquirer/prompts 8)
├── scripts/                 dataset.json: real IT catalog (test fixture); dataset.types.ts: its full
│                            shape, for reference; vps-italia.ts: debug script
├── Dockerfile               deps stage (prod node_modules) → node:24-alpine runtime as `node`, /data volume, HEALTHCHECK
├── docker-compose.yaml      production: ghcr.io/jacopofilonzi/ovh-vps-stocknotifier:latest, ./data:/data
├── docker-compose.dev.yaml  development: builds the image from this checkout
├── .github/workflows/       docker.yml: check → multi-arch publish to GHCR → cleanup of untagged images;
│                            smoke.yml: live OVH API check, manual only
├── .env.example             every supported env var, documented; `.env` is git-ignored
└── Makefile                 dev commands (run `make help`); data in ./temp
```

## Commands (`src/main.ts`)

`node src/main.ts <command>`; each `run*` function returns the exit code.

| Command | Module | Does |
| --- | --- | --- |
| `scraper [--once]` | `scraper/index.ts` | Main loop (`--once`: one check, exit 1 on any problem) |
| `tui` | `tui/index.ts` | Wizard on first run, then the settings menu; needs a TTY |
| `check-now` | `check-now.ts` | Asks the running scraper for a check, waits up to 75 s |
| `status` | `status.ts` | Prints the stored stock table |
| `healthcheck` | `healthcheck.ts` | Docker HEALTHCHECK: exit 1 if stale (> 3 min), halted, stopped or no success for max(1 h, 6 intervals) |
| `smoke` | `smoke.ts` | Live check of the OVH APIs for IT, CA and US (one per API host) |

## Modules (`src/`)

| Path | Responsibility |
| --- | --- |
| `scraper/index.ts` | Process lifecycle: wait for a usable config, run checks, heartbeat, notify, save, clean shutdown |
| `scraper/tick.ts` | One check: catalog → orderability → stock → events (updates the state it's given) |
| `scraper/schedule.ts` | Delay to the next check, `waitFor` (timeout, config change, check request, abort), `check-now` consumption |
| `scraper/health.ts` | `ok` / `degraded` / `halted` transitions and the confirmation of incompatible responses |
| `ovh/catalog.ts` | Catalog fetch and parsing → `Catalog` (plans, orderability, specs, prices, datacenters) |
| `ovh/availability.ts` | Stock of one plan (`fetchPlanStock`), of the watched plans (`fetchWatchedStock`), `OS_LABEL` |
| `ovh/schemas.ts` | zod schemas of the fields used: critical vs display |
| `ovh/subsidiaries.ts`, `datacenters.ts`, `price.ts` | Subsidiary → API host and order URL; datacenter labels (Local Zones table); price formatting |
| `state/` | `schema.ts` (state.json), `store.ts` (load, move aside, queued saves, `peekState`), `diff.ts` (events from changes), `liveness.ts` (heartbeat → running / dead / …) |
| `config/` | `schema.ts` (config.json, notifier union), `store.ts` (load + migrations, save), `env.ts` (env vars) |
| `events.ts` | `AppEvent` union (stock, orderability, health, notifier, test), `Notification`, `PlanInfo` builders |
| `notifiers/` | One module per type, registry and `dispatch` (`index.ts`), shared texts (`format.ts`), failing-notifier tracking (`health.ts`), `sendJson` and `mask` (`http.ts`) |
| `tui/` | `index.ts` (entry), `wizard.ts`, `menu.ts`, one file per setting (`location`, `plans`, `options`, `notifiers` + `notifier-forms`), `preview.ts` (test and live-data notifications), `check-now.ts`, `summary.ts`, `catalog.ts` (catalog cached per session), `prompt.ts` (`ask` with Esc → `BACK`, colors, `pause`, spinner) |
| `shared/` | `http.ts` (`fetchJson`, `ApiError`: transient / request / incompatible), `json-file.ts` (atomic writes), `log.ts`, `paths.ts`, `version.ts`, `table.ts`, `time.ts`, `concurrency.ts` (`mapSettled`) |

## A check (`scraper/tick.ts`)

1. **Catalog**: refetched when older than 30 min or when the subsidiary changes; on a transient error the
   previous copy is used. A change of subsidiary resets plans and stock in the state.
2. **Orderability** of each watched plan (tag `order-funnel:show`). A watched plan with broken critical
   fields is an `incompatible` error.
3. **Stock** of the orderable plans in the watched datacenters they're offered in, at most 4 requests at
   once, per OS. A datacenter missing from the response is left untouched.
4. Plans and stock keys no longer watched are pruned; `scraper/index.ts` then updates health, notifies
   (all events of a check in one notification) and saves.

Schedule: next check `interval` after the previous one ends, ±10% jitter. After failures, exponential
backoff up to 30 min; incompatible responses are retried after max(interval, 10 min), then twice that,
and the 3rd identical one halts the scraper. `degraded` is notified after 3 failed checks (at once for a
4xx). A halted scraper resumes when another version starts.

## OVH APIs

Public, unauthenticated, not documented as stable. Host per subsidiary: `eu.api.ovh.com`,
`ca.api.ovh.com`, `api.us.ovhcloud.com` (see `ovh/subsidiaries.ts`).

- `GET /v1/order/catalog/public/vps?ovhSubsidiary=XX`: plans, specs, prices, datacenters (6+ MB), 30 s timeout
- `GET /1.0/vps/order/rule/datacenter?ovhSubsidiary=XX&planCode=…`: stock per datacenter and OS, 15 s timeout

## Data and state (`DATA_DIR`)

| File | Written by | Content |
| --- | --- | --- |
| `config.json` | TUI only | `configSchemaVersion`, subsidiary, `intervalSeconds` (≥ 60), OS, datacenters, plans, notifiers (with their secrets) |
| `state.json` | scraper only | `stateSchemaVersion`, `phase`, `heartbeat` (every 30 s), plans, stock by `plan@datacenter#os`, health, failing notifiers, `lastEvents` |
| `check-now` | created by the TUI / `check-now`, deleted by the scraper | Request for an immediate check |
| `state.json.corrupt-<timestamp>` | scraper | A `state.json` that failed validation, moved aside |

- `config.json` is durable user data: shape changes need a `CONFIG_SCHEMA_VERSION` bump and a migration.
- `state.json` is rebuildable: a different `stateSchemaVersion` is discarded and rebuilt from scratch.
- Liveness: the TUI calls the scraper "not responding" after 90 s without a heartbeat; the healthcheck
  after 3 min.

## Configuration

Read in `src/config/env.ts`, documented in `.env.example`. `make` and `docker compose` load `.env`.

| Env var | Default | Meaning |
| --- | --- | --- |
| `DATA_DIR` | `./data` (`/data` in Docker, `./temp` with make) | Directory of the data files |
| `LOG_LEVEL` | `info` (`debug` in docker-compose.dev.yaml) | `debug`, `info`, `warn`, `error`; unknown values fall back to `info` with a warning |
| `TZ` | system (`Europe/Rome` in the image) | Time zone of logs and notifications (read by Node) |

## Tests

`*.test.ts` next to the code, run by `node --test` (`make test`):

| File | Covers |
| --- | --- |
| `ovh/ovh.test.ts` | Catalog and stock parsing against `scripts/dataset.json` and inline responses |
| `scraper/tick.test.ts` | `runTick` with the fixture catalog and a stubbed `fetch` |
| `scraper/scraper.test.ts` | Health transitions, `nextDelayMs` |
| `state/diff.test.ts`, `state/liveness.test.ts` | Events from changes, liveness |
| `notifiers/notifiers.test.ts` | Texts, notifier health, every sender against a local HTTP server |

Not covered: `config/store.ts`, `state/store.ts`, the healthcheck, the TUI.

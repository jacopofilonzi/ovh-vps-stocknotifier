# OVH VPS Stock Notifier

Watches the stock of OVHcloud VPS plans and notifies you when the plans you care about become
available (or run out again) in the datacenters you choose.

## Quick start (Docker)

```sh
mkdir ovh-vps-stocknotifier && cd ovh-vps-stocknotifier
# copy docker-compose.yaml from this repository here, then:
mkdir data
docker compose up -d                      # start the scraper: it waits for a configuration
docker compose run --rm notifier tui      # configure it: it starts checking within seconds
docker compose logs -f                    # follow what it does
```

The image is private as long as the repository is: see
[Deploying from GHCR](#deploying-from-ghcr-private-repository) to log in first.

On Linux, `data/` must be writable by the container user (uid 1000):
`sudo chown 1000:1000 data` if you created it as another user. The scraper tells you if it isn't.

## What it watches

- **Stock** of each selected plan, per datacenter and per operating system (Linux and/or
  Windows: OVH tracks them separately).
- **Orderability**: whether a plan is still on sale (shown in OVH's order funnel), so you know
  when a plan you watch is withdrawn, or comes back.

Notifications are sent only when something changes, never on every check.

## Supported subsidiaries

Prices, currency and VAT follow the OVH subsidiary you choose:
IT, FR, DE, ES, GB, IE, NL, PL, PT, MA, SN, TN, CA, QC, AU, SG, IN, ASIA, WE, WS, US.

The US subsidiary has its own plan codes and datacenters.

## Configuration (TUI)

The TUI writes `config.json`; the scraper picks up every change within a few seconds, no restart
needed.

- **First run**: a setup wizard asks, in order, for the subsidiary, datacenters, operating
  systems, plans, notifiers (optional) and check interval. Nothing is saved until you confirm
  at the end, so the scraper never starts from a half-done configuration.
- **Afterwards**: a settings menu, with a summary of the configuration and of the scraper's
  status. Every confirmed change is saved right away.
- **Plans** are listed with vCore, RAM and monthly price, and only those on sale in the selected
  datacenters. A watched plan that was withdrawn stays listed as `(withdrawn)`.
- **Notifiers** can be tested with a plain test message, or with a *preview with live data*: the
  current stock of your plans, fetched right now (marked `[TEST]`, without touching the stored
  state). *Send current stock to all enabled notifiers* in the main menu does the same in one
  step.
- Changing the subsidiary or the datacenters removes, after asking, the choices that no longer
  apply.

Keys: arrows to move, Space to toggle, Enter to confirm, **Esc to go back**, Ctrl+C to quit.

```text
OVH VPS Stock Notifier 1.0.0
 Subsidiary   IT · Italy (EUR)
 Datacenters  Milano (IT)
 OS           Linux
 Plans        VPS-1 2027, VPS-2 2027
 Notifiers    Telegram ✓, ntfy ✓
 Interval     5 min
 Scraper      ✅ running · last check 11:40:02

? What do you want to do?
❯ Subsidiary          IT · Italy (EUR)
  Datacenters         Milano (IT)
  ...
```

## Notifiers

You can configure any number of notifiers, of any type, and disable them without deleting them.

| Type | What you need |
| --- | --- |
| **Telegram** | A bot token from [@BotFather](https://t.me/BotFather) and the chat id to write to. Send a message to your bot, then open `https://api.telegram.org/bot<token>/getUpdates`: the chat id is in `message.chat.id` (negative for groups). |
| **Discord** | A channel webhook URL: *Channel settings → Integrations → Webhooks → New webhook → Copy URL*. Every change is shown as an embed. |
| **Custom webhook** | A URL, the method (`POST` or `PUT`) and optional headers (e.g. for authentication). The body is described below. |
| **Gotify** | The server URL and an application token (*Apps → Create application*), plus the message priority (0-10). |
| **ntfy** | The server URL (`https://ntfy.sh` or your own), the topic, an optional access token, and the priority (1-5). |

If a notifier fails (e.g. a revoked token), the error is logged and reported once on the other
notifiers that work, and again when it recovers.

### Custom webhook body

```jsonc
{
  "title": "🟢 VPS-2 2027 available in Milano (IT)",
  "text": "🟢 VPS-2 2027 (4 vCore, 8 GB, €8.49 + VAT (€10.36)) available in Milano (IT) (Linux)\nOrder: https://www.ovhcloud.com/it/vps/",
  "test": false,
  "subsidiary": "IT",
  "orderUrl": "https://www.ovhcloud.com/it/vps/",
  "timestamp": "2026-10-07T11:40:00.000Z",
  "version": "1.0.0",
  "events": [
    {
      "kind": "stock",                   // stock | orderability | health | notifier
      "status": "available",             // stock: available | out-of-stock
      "plan": { "planCode": "vps-2027-model2", "invoiceName": "VPS-2 2027", "vCore": 4, "ramGb": 8, "price": "€8.49 + VAT (€10.36)" },
      "datacenter": { "code": "EU-SOUTH-MIL", "label": "Milano (IT)" },
      "os": "linux",
      "message": "VPS-2 2027 (4 vCore, 8 GB, €8.49 + VAT (€10.36)) available in Milano (IT) (Linux)"
    }
  ]
}
```

Other event kinds: `orderability` (`orderable`, `plan`), `health` (`status`: `degraded`,
`recovered`, `halted` or `state-reset`, `detail`), `notifier` (`id`, `name`, `failing`, `error`)
and `test` (sent from the TUI). Every event has a ready-made `message`.

## How it works

- **Schedule.** The first check runs at startup, the next one `interval` after the previous
  one ends (±10% jitter), so checks never overlap. `config.json` is re-read before every check,
  and a change while waiting reschedules the next check right away.
- **Waiting for a configuration.** Without a usable `config.json` (missing, or no plan or
  datacenter selected) the scraper waits for one instead of exiting: you can start it first and
  configure it afterwards.
- **First run.** Plans and stock seen for the first time are recorded without notifications,
  except a plan that is already available, or one that is already withdrawn. The same applies to
  plans and datacenters added later.
- **Notifications.** Only changes are notified: available, out of stock, withdrawn from sale,
  orderable again. All the changes of one check go into a single notification. If no notifier
  can deliver it, the changes are retried on the next check.
- **Errors.** A failed request leaves the stored state untouched, so a network error never
  becomes a false "out of stock". After failures the next check is delayed exponentially (up to
  30 minutes), and you're notified if monitoring stays degraded for 3 checks in a row.
- **Data files.** `config.json` is written only by the TUI, `state.json` only by the scraper,
  always atomically. A corrupted `state.json` is moved aside and rebuilt (you're notified); one
  written by an incompatible version is discarded.
- **Healthcheck.** The Docker image marks the container `unhealthy` (see `docker ps`) when the
  scraper is stuck, halted, or hasn't completed a check for more than an hour (or 6 intervals).
  Waiting for a configuration counts as healthy.

## How it deals with API changes

OVH's public order APIs aren't documented as stable, so every response is validated against
the fields this app actually uses:

- Changes to fields the app doesn't use are ignored.
- Changes to fields it relies on (plan codes, orderability, datacenters, stock statuses) make the
  response *incompatible*. To rule out a temporary glitch, the check is retried twice, 10 and 20
  minutes later (or more, with longer intervals). If the same problem persists, monitoring stops
  instead of sending wrong notifications, and you're told to update to a newer version.
- A stopped scraper stays up (so Docker doesn't restart it in a loop) and reports itself as
  unhealthy. It tries again once when restarted or when `config.json` changes, without notifying
  the same problem twice, and resumes normally when a new version is deployed.
- Specs and prices are only displayed: if they can't be read they're shown as `n/a`.

`make smoke` checks the live APIs against these expectations. GitHub Actions runs it every
Monday and on every push to `main`: if OVH changes something, the failed workflow tells you
before your scraper does.

## Deploying from GHCR (private repository)

Every push to `main` publishes `ghcr.io/jacopofilonzi/ovh-vps-stocknotifier:latest` for
`linux/amd64` and `linux/arm64`. The image inherits the repository's visibility, so while the
repository is private the server must log in once:

1. On GitHub: *Settings → Developer settings → Personal access tokens → Tokens (classic) →
   Generate new token*, with **only** the `read:packages` scope. At the time of writing the
   container registry doesn't accept fine-grained tokens.
2. On the server:

   ```sh
   docker login ghcr.io -u <your-github-username>   # password: the token
   ```

   Docker stores the token in `~/.docker/config.json` (encoded, not encrypted): with only
   `read:packages`, a leaked token can only download your images.
3. Update with:

   ```sh
   docker compose pull && docker compose up -d
   ```

The workflow also deletes untagged images (keeping the latest 5), so replaced `latest` builds
don't fill the free GHCR storage.

### Releasing a version

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v1.2.3 && git push --tags`.

The workflow checks the tag matches `package.json` and publishes `1.2.3` and `1.2`. To pin a
version on the server, use e.g. `ghcr.io/jacopofilonzi/ovh-vps-stocknotifier:1.2` in
`docker-compose.yaml`.

## Local development

Requirements: Node.js 24+, pnpm 10, GNU make.

```sh
make install
make check
```

Locally, data files live in `./temp` instead of `/data` (see `DATA_DIR`).

| Target | Description |
| --- | --- |
| `make help` | List the available targets |
| `make install` | Install dependencies |
| `make tui` | Open the configuration TUI |
| `make scraper` | Run the scraper in the foreground (Ctrl+C to stop) |
| `make dev` | Run the scraper, restarting it when a file in `src/` changes |
| `make once` | Run a single check and exit |
| `make status` | Print the stored stock status |
| `make reset-state` | Delete `state.json`, to simulate a first run (keeps the config) |
| `make test` | Run the unit tests |
| `make typecheck` | Type-check the code (node runs `.ts` files without checking types) |
| `make check` | Type-check and test, run before committing |
| `make smoke` | Check the live OVH APIs still match this version |
| `make clean` | Delete the local data directory |
| `make docker-build` | Build the Docker image from this checkout |
| `make docker-up` | Start the scraper in the development container (data in `./data`) |
| `make docker-tui` | Open the TUI in the development container |

The `docker-*` targets use `docker-compose.dev.yaml`, which builds the image locally instead of
pulling it from GHCR.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DATA_DIR` | `./data` (`/data` in Docker, `./temp` with make) | Directory of `config.json` and `state.json` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `TZ` | system (`Europe/Rome` in the image) | Time zone used in logs and notifications |

## Disclaimer

- This project is **not affiliated with, endorsed or supported by OVHcloud**. "OVHcloud" is a
  trademark of OVH SAS.
- It relies on public OVHcloud APIs that are **not documented as stable**: they may change or stop
  working at any time.
- Stock and prices are **indicative only**: what counts is what the OVHcloud website shows when you
  order.
- Use reasonable check intervals and respect OVHcloud's terms of service. This tool does not order
  anything and is not meant for automated ordering or high-volume requests.
- The software is provided "as is", without warranty of any kind. The author is not liable for
  missed, late or wrong notifications.

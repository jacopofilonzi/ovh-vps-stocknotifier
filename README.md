# OVH VPS Stock Notifier

Watches the stock of OVHcloud VPS plans and notifies you when the plans you care about become
available (or run out again) in the datacenters you choose.

> **Work in progress.** The scraper and the notifiers work; the TUI and the Docker
> images are being built. This README grows with them.

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
`recovered`, `halted` or `state-reset`, `detail`) and `notifier` (`id`, `name`, `failing`, `error`).
Every event has a ready-made `message`.

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
- **Healthcheck.** `node src/main.ts healthcheck` fails when the scraper is stuck, halted, or
  hasn't completed a check for more than an hour (or 6 intervals).

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

`make smoke` checks the live APIs against these expectations.

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

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DATA_DIR` | `./data` (`/data` in Docker, `./temp` with make) | Directory of `config.json` and `state.json` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `TZ` | system | Time zone used in logs and notifications |

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

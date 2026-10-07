# OVH VPS Stock Notifier

Watches the stock of OVHcloud VPS plans and notifies you when the plans you care about become
available (or run out again) in the datacenters you choose.

> **Work in progress.** The OVH API layer is done; the scraper, notifiers, TUI and Docker
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

## How it deals with API changes

OVH's public order APIs aren't documented as stable, so every response is validated against
the fields this app actually uses:

- Changes to fields the app doesn't use are ignored.
- Changes to fields it relies on (plan codes, orderability, datacenters, stock statuses) make the
  response *incompatible*: monitoring stops instead of sending wrong notifications, and you're
  told to update to a newer version.

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

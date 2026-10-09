# Local development without Docker. Works with GNU make on Linux, macOS and Windows:
# recipes only call node/pnpm, so they run the same under sh and cmd.

# Local data directory (Docker uses /data). Override with: make <target> DATA_DIR=...
export DATA_DIR ?= ./temp

# Node reads .env (see .env.example) when it exists. It never overrides variables already set,
# so DATA_DIR above wins over the one in .env.
NODE := node --env-file-if-exists=.env

.DEFAULT_GOAL := help
.PHONY: help install tui scraper dev once check-now status reset-state test typecheck check smoke clean docker-build docker-up docker-tui

help: ## List the available targets
	@node -e "for (const l of require('fs').readFileSync('Makefile','utf8').split('\n')) { const m = l.match(/^([a-z-]+):.*## (.*)/); if (m) console.log('  ' + m[1].padEnd(14) + m[2]); }"

install: ## Install dependencies
	pnpm install --frozen-lockfile

tui: ## Open the configuration TUI
	$(NODE) src/main.ts tui

scraper: ## Run the scraper in the foreground (Ctrl+C to stop)
	$(NODE) src/main.ts scraper

dev: ## Run the scraper, restarting it when a file in src/ changes
	$(NODE) --watch-path=src src/main.ts scraper

once: ## Run a single check and exit
	$(NODE) src/main.ts scraper --once

check-now: ## Ask the running scraper (make scraper) for an immediate check
	$(NODE) src/main.ts check-now

status: ## Print the stored stock status
	$(NODE) src/main.ts status

reset-state: ## Delete state.json, to simulate a first run (keeps the config)
	node -e "require('fs').rmSync(require('path').join(process.env.DATA_DIR, 'state.json'), { force: true })"

test: ## Run the unit tests
	pnpm test

typecheck: ## Type-check the code (node runs .ts files without checking types)
	pnpm typecheck

check: typecheck test ## Type-check and test, run before committing

smoke: ## Check the live OVH APIs still match this version
	$(NODE) src/main.ts smoke

clean: ## Delete the local data directory
	node -e "require('fs').rmSync(process.env.DATA_DIR, { recursive: true, force: true })"

docker-build: ## Build the Docker image from this checkout
	docker compose -f docker-compose.dev.yaml build

docker-up: ## Start the scraper in the development container (data in ./data)
	docker compose -f docker-compose.dev.yaml up -d --build

docker-tui: ## Open the TUI in the development container
	docker compose -f docker-compose.dev.yaml run --rm notifier tui

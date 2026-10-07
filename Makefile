# Local development without Docker. Works with GNU make on Linux, macOS and Windows:
# recipes only call node/pnpm, so they run the same under sh and cmd.

# Local data directory (Docker uses /data). Override with: make <target> DATA_DIR=...
export DATA_DIR ?= ./temp

.DEFAULT_GOAL := help
.PHONY: help install test typecheck check smoke clean

help: ## List the available targets
	@node -e "for (const l of require('fs').readFileSync('Makefile','utf8').split('\n')) { const m = l.match(/^([a-z-]+):.*## (.*)/); if (m) console.log('  ' + m[1].padEnd(14) + m[2]); }"

install: ## Install dependencies
	pnpm install --frozen-lockfile

test: ## Run the unit tests
	pnpm test

typecheck: ## Type-check the code (node runs .ts files without checking types)
	pnpm typecheck

check: typecheck test ## Type-check and test, run before committing

smoke: ## Check the live OVH APIs still match this version
	node src/main.ts smoke

clean: ## Delete the local data directory
	node -e "require('fs').rmSync(process.env.DATA_DIR, { recursive: true, force: true })"

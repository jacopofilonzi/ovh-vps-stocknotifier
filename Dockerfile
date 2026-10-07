# Node runs the TypeScript sources directly: no build step, only production dependencies.

FROM node:24-alpine AS deps
WORKDIR /app
# corepack installs the pnpm version pinned in package.json ("packageManager")
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine
LABEL org.opencontainers.image.source="https://github.com/jacopofilonzi/ovh-vps-stocknotifier"
LABEL org.opencontainers.image.description="Watches OVHcloud VPS stock and notifies you when a plan becomes available"
RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    DATA_DIR=/data \
    TZ=Europe/Rome
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data

# Unhealthy when the scraper is stuck, halted, or hasn't completed a check for too long.
HEALTHCHECK --interval=1m --timeout=10s --start-period=2m --retries=2 \
    CMD ["node", "src/main.ts", "healthcheck"]

ENTRYPOINT ["node", "src/main.ts"]
CMD ["scraper"]

import pkg from "../../package.json" with { type: "json" };

export const APP_NAME = "OVH VPS Stock Notifier";
export const APP_VERSION: string = pkg.version;
export const REPO_URL = "https://github.com/jacopofilonzi/ovh-vps-stocknotifier";
export const USER_AGENT = `ovh-vps-stocknotifier/${APP_VERSION} (+${REPO_URL})`;

import path from "node:path";

/** Directory holding config.json and state.json. `/data` in Docker, `./temp` for local development. */
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");

export const CONFIG_PATH = path.join(DATA_DIR, "config.json");
export const STATE_PATH = path.join(DATA_DIR, "state.json");

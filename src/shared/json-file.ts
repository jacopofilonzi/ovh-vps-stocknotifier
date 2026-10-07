import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ReadResult =
  | { status: "missing" }
  | { status: "unparsable"; error: string }
  | { status: "ok"; data: unknown };

export async function readJsonFile(file: string): Promise<ReadResult> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    throw err;
  }
  try {
    return { status: "ok", data: JSON.parse(text) };
  } catch (err) {
    return { status: "unparsable", error: (err as Error).message };
  }
}

/** Writes to a temporary file and renames it, so readers never see a half-written file. */
export async function writeJsonFile(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

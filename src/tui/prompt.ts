import { AbortPromptError } from "@inquirer/core";
import { select } from "@inquirer/prompts";
import type { Prompt } from "@inquirer/type";
import { emitKeypressEvents } from "node:readline";

/** Returned by a prompt or a screen when the user pressed Esc. */
export const BACK = Symbol("back");
export type Back = typeof BACK;

/** Runs an inquirer prompt; Esc cancels it and returns BACK. Ctrl+C still throws ExitPromptError. */
export async function ask<Value, Config>(prompt: Prompt<Value, Config>, config: Config): Promise<Value | Back> {
  const controller = new AbortController();
  const onKeypress = (_: string, key?: { name?: string }) => {
    if (key?.name === "escape") controller.abort();
  };
  emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", onKeypress);
  try {
    return await prompt(config, { signal: controller.signal });
  } catch (err) {
    if (err instanceof AbortPromptError) return BACK;
    throw err;
  } finally {
    process.stdin.off("keypress", onKeypress);
  }
}

export const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
export const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
export const red = (text: string) => `\x1b[31m${text}\x1b[39m`;
export const green = (text: string) => `\x1b[32m${text}\x1b[39m`;
export const yellow = (text: string) => `\x1b[33m${text}\x1b[39m`;

export function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

/** Shows `lines` until the user presses Enter or Esc. */
export async function pause(lines: string[] = []) {
  if (lines.length) console.log(lines.join("\n") + "\n");
  await ask(select, { message: "", choices: [{ name: "← Back", value: "back" }], theme: { prefix: "" } });
}

/** Prints `message…` while `task` runs, then clears the line. */
export async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const timer = setInterval(() => process.stdout.write(`\r${frames[i++ % frames.length]} ${message}…`), 80);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    process.stdout.write("\r\x1b[2K");
  }
}

/**
 * Configuration loader. Reads `config/default.json` shipped with the package.
 *
 * Pi extension convention: don't read from `~/.pi/` or `.pi/settings.json`
 * for our own config; we ship a default JSON file and the user can override
 * via Pi's settings system if they ever need to.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { TachikomaMemoryError } from "./types.js";
import type { Config } from "./types.js";

let cached: Config | null = null;

export function readConfig(): Config {
  if (cached) return cached;
  const path = locateDefaultConfig();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new TachikomaMemoryError(
      `Could not read config at ${path}: ${(e as Error).message}`,
      "config",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new TachikomaMemoryError(
      `Config at ${path} is not valid JSON: ${(e as Error).message}`,
      "config",
    );
  }
  const cfg = validateConfig(parsed);
  cached = cfg;
  return cfg;
}

export function resetConfigCache(): void {
  cached = null;
}

function locateDefaultConfig(): string {
  // Pi loads our extension as ESM via jiti, so import.meta.url works.
  // We resolve relative to this file to find the shipped config/default.json.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "..", "config", "default.json");
  } catch {
    // Fallback (e.g. tests / weird imports): relative to CWD
    const cwd = process.cwd();
    const cand1 = resolve(cwd, "config", "default.json");
    const cand2 = resolve(cwd, "..", "config", "default.json");
    if (existsSync(cand1)) return cand1;
    if (existsSync(cand2)) return cand2;
    return cand1;
  }
}

function validateConfig(raw: unknown): Config {
  if (!raw || typeof raw !== "object") {
    throw new TachikomaMemoryError("config must be an object", "config");
  }
  const o = raw as Record<string, unknown>;

  // Minimal shape check; deeper validation lives in the consumer (state.ts / hooks).
  const required = [
    "tickId",
    "tachikomaNumber",
    "hindsight",
    "mnemosyne",
    "session",
    "principal",
  ];
  for (const k of required) {
    if (!(k in o)) {
      throw new TachikomaMemoryError(`config missing required field: ${k}`, "config");
    }
  }
  return o as unknown as Config;
}

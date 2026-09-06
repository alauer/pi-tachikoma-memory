/**
 * Mnemosyne subprocess wrapper.
 *
 * Talks to the `mnemosyne` CLI (Python) via `child_process.spawn`. All args are
 * POSITIONAL (flag-style `--source X` is rejected by argparse — confirmed in
 * findings.md Edge case 3).
 *
 * Reads `MNEMOSYNE_DATA_DIR` env var at call time (not module-load), so
 * callers can override per-call without restarting.
 *
 * Errors are normalized to `TachikomaMemoryError(source: "mnemosyne")`.
 */

import { spawn } from "node:child_process";
import { getSession } from "../state.js";
import { TachikomaMemoryError } from "../types.js";
import type { MnemosyneMemory, MnemosyneStats } from "../types.js";
import {
  stripMnemosyneHeader,
  parseMnemosyneRecall,
} from "./formats.js";

// ─── Low-level subprocess runner ──────────────────────────────────────────

interface RunOpts {
  dataDir?: string;          // explicit override beats env beats config
  timeoutMs?: number;         // default 30s for long ops like sleep()
}

async function runMnemosyne(args: string[], opts: RunOpts = {}): Promise<string> {
  const cfg = getSession().config.mnemosyne;
  // Resolution order: explicit opt → process.env.MNEMOSYNE_DATA_DIR → session config
  const dataDir =
    opts.dataDir ??
    process.env.MNEMOSYNE_DATA_DIR ??
    cfg.dataDir;

  // The binary path. Prefer whatever the user configured; default to PATH lookup.
  const bin = cfg.cliBinary || "mnemosyne";

  return new Promise((resolve, reject) => {
    const env = { ...process.env, MNEMOSYNE_DATA_DIR: dataDir };
    let stdout = "";
    let stderr = "";
    let settled = false;

    let child;
    try {
      child = spawn(bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
    } catch (e) {
      const msg = (e as Error).message;
      reject(
        new TachikomaMemoryError(
          `${bin} not found on PATH or failed to launch: ${msg}. Install with \`pip install mnemosyne-memory\`.`,
          "mnemosyne",
        ),
      );
      return;
    }

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(
        new TachikomaMemoryError(
          `mnemosyne ${args[0]}? timed out after ${opts.timeoutMs ?? 30000}ms: ${stderr.trim()}`,
          "mnemosyne",
        ),
      );
    }, opts.timeoutMs ?? 30000);

    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const msg = (e as Error).message;
      reject(
        new TachikomaMemoryError(
          `${bin} not found or failed to launch: ${msg}. Install with \`pip install mnemosyne-memory\`.`,
          "mnemosyne",
        ),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new TachikomaMemoryError(
            `mnemosyne ${args[0] ?? ""} exited with code ${code}: ${stderr.trim() || "(no stderr)"}`,
            "mnemosyne",
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

// ─── High-level operations ────────────────────────────────────────────────

export interface MnemosyneStoreOpts {
  content: string;
  source?: string;       // default: "tachikoma-memory"
  importance?: number;   // default: 0.5
  scope?: "session" | "global"; // forward-compat (current CLI ignores)
}

export async function mnemosyneStore(opts: MnemosyneStoreOpts): Promise<{ id: string }> {
  const args: string[] = ["store", opts.content];
  if (opts.source !== undefined) args.push(opts.source);
  if (opts.importance !== undefined) args.push(String(opts.importance));
  // scope is omitted: Mnemosyne CLI reads MNEMOSYNE_DEFAULT_SCOPE env var.
  const out = await runMnemosyne(args);
  // Expected output is `Stored: <id>` (or similar)
  const match = out.match(/Stored:\s*(\S+)/i) ?? out.match(/^\s*([0-9a-f-]{6,})\s*$/im);
  if (!match) {
    throw new TachikomaMemoryError(
      `mnemosyne store produced unexpected output: ${out.slice(0, 200)}`,
      "mnemosyne",
    );
  }
  return { id: match[1] };
}

export interface MnemosyneRecallOpts {
  query: string;
  topK?: number; // 1-50, default 5
}

export async function mnemosyneRecall(opts: MnemosyneRecallOpts): Promise<MnemosyneMemory[]> {
  const topK = opts.topK ?? 5;
  const args = ["recall", opts.query, String(topK)];
  const out = await runMnemosyne(args);
  return parseMnemosyneRecall(out);
}

export interface MnemosyneForgetOpts {
  id: string;
}

export async function mnemosyneForget(opts: MnemosyneForgetOpts): Promise<{ success: boolean }> {
  // Mnemosyne CLI uses `delete` for the remove operation
  const out = await runMnemosyne(["delete", opts.id]);
  // Heuristic success check: empty string or "Deleted:" prefix
  const ok = /deleted|removed|ok/i.test(out) || out.trim() === "";
  return { success: ok };
}

export async function mnemosyneStats(): Promise<MnemosyneStats> {
  const out = await runMnemosyne(["stats"]);
  // Parse the formatted output. Shape (from CLI):
  //
  //   Mnemosyne Stats
  //
  //     Total memories: 12
  //     Working memory: 5
  //     Episodic memory: 7
  //     Knowledge triples: 0
  //
  //     Banks: default
  //     DB path: /path/to/mnemosyne.db
  const totalMatch = /Total memories:\s*(\d+)/.exec(out);
  const workingMatch = /Working memory:\s*(\d+)/.exec(out);
  const episodicMatch = /Episodic memory:\s*(\d+)/.exec(out);
  const triplesMatch = /Knowledge triples:\s*(\d+)/.exec(out);
  const banksMatch = /Banks:\s*([^\n]+)/.exec(out);
  const dbMatch = /DB path:\s*([^\n]+)/.exec(out);

  return {
    total: totalMatch ? parseInt(totalMatch[1], 10) : 0,
    working: workingMatch ? parseInt(workingMatch[1], 10) : 0,
    episodic: episodicMatch ? parseInt(episodicMatch[1], 10) : 0,
    triples: triplesMatch ? parseInt(triplesMatch[1], 10) : 0,
    banks: banksMatch ? banksMatch[1].trim() : "default",
    dbPath: dbMatch ? dbMatch[1].trim() : "",
  };
}

export async function mnemosyneSleep(): Promise<{
  consolidated?: number;
  status?: string;
}> {
  // mnemosyne sleep can run for a long time (consolidation LLM call)
  const out = await runMnemosyne(["sleep"], { timeoutMs: 300_000 });
  // The CLI says something like "Consolidated N memories" or returns a JSON.
  // Be tolerant: parse if we can find a number.
  const match = /Consolidated\s*(\d+)/i.exec(out) ?? /consolidated[_:\s]+(\d+)/i.exec(out);
  const result: { consolidated?: number; status?: string } = {};
  if (match) result.consolidated = parseInt(match[1], 10);
  if (out.trim()) result.status = out.trim().slice(0, 500);
  return result;
}

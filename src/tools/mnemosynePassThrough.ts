/**
 * Tool: tachikoma_mnemosyne
 *
 * Pass-through to Mnemosyne L1. Five ops: store / recall / forget / stats / sleep.
 *
 * Mnemosyne's CLI takes positional args (no --flag style); this tool mirrors that.
 *
 * To keep Pi's tool return-type unification happy, every successful path returns
 * a uniform `details` shape with ALL fields (`ok, error, op, id?, count?, dbPath?,
 * status?`) — fields that don't apply are `undefined`. The catch path returns
 * the same shape with `ok=false, error=true`.
 */

import {
  mnemosyneStore,
  mnemosyneRecall,
  mnemosyneForget,
  mnemosyneStats,
  mnemosyneSleep,
} from "../memory/mnemosyne.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Uniform details shape across all branches — all fields present.
interface MnemosyneDetails {
  ok: boolean;
  error: boolean;
  op: string;
  id?: string;
  count?: number;
  dbPath?: string;
  status?: string;
}

const baseDetails = (op: string): MnemosyneDetails => ({
  ok: false,
  error: true,
  op,
  id: undefined,
  count: undefined,
  dbPath: undefined,
  status: undefined,
});

export function registerMnemosynePassThroughTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tachikoma_mnemosyne",
    label: "Tachikoma: Mnemosyne (L1 Pass-through)",
    description:
      "Pass-through to the Mnemosyne L1 personal memory bank. Operations: store, recall, forget, stats, sleep.",
    parameters: {
      type: "object",
      properties: {
        op: {
          type: "string",
          enum: ["store", "recall", "forget", "stats", "sleep"],
          description: "Operation.",
        },
        content: { type: "string", description: "For store: the memory content." },
        source: { type: "string", description: "For store: source tag (default 'tachikoma')." },
        importance: {
          type: "number",
          description: "For store: importance 0.0–1.0 (default 0.5).",
        },
        query: { type: "string", description: "For recall: query string." },
        top_k: { type: "number", description: "For recall: per-K (default 5)." },
        id: { type: "string", description: "For forget: memory id to delete." },
      },
      required: ["op"],
    } as Record<string, unknown>,
    async execute(_id: string, params) {
      const p = params as {
        op: "store" | "recall" | "forget" | "stats" | "sleep";
        content?: string;
        source?: string;
        importance?: number;
        query?: string;
        top_k?: number;
        id?: string;
      };
      const op = p.op;

      try {
        if (op === "store") {
          if (!p.content) throw new Error("content required for store");
          const r = await mnemosyneStore({
            content: p.content,
            source: p.source ?? "tachikoma",
            importance: p.importance ?? 0.5,
          });
          const d: MnemosyneDetails = { ...baseDetails(op), ok: true, error: false, id: r.id };
          return {
            content: [{ type: "text" as const, text: `Stored: ${r.id}` }],
            details: d,
          };
        }

        if (op === "recall") {
          if (!p.query) throw new Error("query required for recall");
          const memories = await mnemosyneRecall({
            query: p.query,
            topK: p.top_k ?? 5,
          });
          const d: MnemosyneDetails = {
            ...baseDetails(op),
            ok: true,
            error: false,
            count: memories.length,
          };
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(memories, null, 2) },
            ],
            details: d,
          };
        }

        if (op === "forget") {
          if (!p.id) throw new Error("id required for forget");
          const r = await mnemosyneForget({ id: p.id });
          const d: MnemosyneDetails = {
            ...baseDetails(op),
            ok: r.success,
            error: !r.success,
            id: p.id,
          };
          return {
            content: [
              {
                type: "text" as const,
                text: r.success
                  ? `Forgot memory ${p.id}`
                  : `Forget may have failed for ${p.id}`,
              },
            ],
            details: d,
          };
        }

        if (op === "stats") {
          const stats = await mnemosyneStats();
          const d: MnemosyneDetails = {
            ...baseDetails(op),
            ok: true,
            error: false,
            dbPath: stats.dbPath,
          };
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(stats, null, 2) },
            ],
            details: d,
          };
        }

        if (op === "sleep") {
          const result = await mnemosyneSleep();
          const d: MnemosyneDetails = {
            ...baseDetails(op),
            ok: true,
            error: false,
            status: result.status,
          };
          return {
            content: [
              {
                type: "text" as const,
                text: `Sleep complete: ${result.status ?? "(no output)"}`,
              },
            ],
            details: d,
          };
        }

        // Unknown op
        const d: MnemosyneDetails = { ...baseDetails(op), ok: false, error: true };
        return {
          content: [
            { type: "text" as const, text: `tachikoma_mnemosyne: unknown op '${op}'` },
          ],
          details: d,
        };
      } catch (e) {
        const d: MnemosyneDetails = {
          ...baseDetails(op),
          ok: false,
          error: true,
          status: (e as Error).message,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: `tachikoma_mnemosyne ${op} failed: ${(e as Error).message}`,
            },
          ],
          details: d,
        };
      }
    },
  });
}

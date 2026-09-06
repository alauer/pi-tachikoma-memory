/**
 * Tool: tachikoma_force_refresh
 *
 * Guided-refresh for a stuck mental model. Workflow:
 *   1. PATCH the mental model's source_query to the supplied content_hint
 *      (preferred) or the existing source_query (default).
 *   2. POST refresh; poll the operation until it completes.
 *   3. Fetch detail=full and return the new content.
 *
 * Why this exists: Hindsight doesn't accept a `current_content` field on PATCH,
 * so we *engineer* the content by routing through reflect with a tightly
 * crafted source_query. This is "guided force-refresh", not literal force-write.
 */

import {
  updateMentalModel,
  refreshMentalModel,
  awaitOperation,
  getMentalModel,
} from "../memory/hindsight.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerForceRefreshTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tachikoma_force_refresh",
    label: "Tachikoma: Force Refresh Mental Model",
    description:
      "Re-refresh a mental model in the doctrine bank. If `content_hint` is provided, it is used as the new source_query so reflect produces content matching that hint. Without the hint, the existing source_query is reused and the refresh re-runs.",
    parameters: {
      type: "object",
      properties: {
        mental_model_id: {
          type: "string",
          description: "ID of the mental model to refresh.",
        },
        content_hint: {
          type: "string",
          description:
            "Optional hint that becomes the new source_query (use this to steer reflect toward the desired content).",
        },
      },
      required: ["mental_model_id"],
    } as Record<string, unknown>,
    async execute(_id: string, params) {
      const p = params as { mental_model_id: string; content_hint?: string };
      try {
        // 1. Optionally PATCH source_query
        if (typeof p.content_hint === "string" && p.content_hint.length > 0) {
          await updateMentalModel(p.mental_model_id, {
            source_query: p.content_hint,
          });
        }

        // 2. Trigger refresh and poll until terminal
        const op = await refreshMentalModel(p.mental_model_id, {
          bank: "doctrine",
        });
        const finalOp = await awaitOperation(op.operation_id, {
          bank: "doctrine",
          pollMs: 2000,
          maxAttempts: 30,
        });

        // 3. Fetch refreshed model
        const full = await getMentalModel(p.mental_model_id, {
          bank: "doctrine",
          detail: "full",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  operation: finalOp,
                  model_id: full.id,
                  last_refreshed_at: full.last_refreshed_at,
                  is_stale: full.is_stale ?? null,
                  content_len: (full.content ?? "").length,
                  content_preview: (full.content ?? "").slice(0, 500),
                },
                null,
                2,
              ),
            },
          ],
          details: { ok: true, error: false, status: finalOp.status },
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `tachikoma_force_refresh failed: ${(e as Error).message}`,
            },
          ],
          details: { ok: false, error: true, status: "failed" },
        };
      }
    },
  });
}

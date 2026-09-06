/**
 * Tool: tachikoma_doctrine_status
 *
 * Lists mental models for the doctrine bank with staleness indicators.
 * Helps the agent (and the user) see which mental models are fresh and which
 * have been waiting for a refresh.
 */

import { getSession } from "../state.js";
import {
  listMentalModels,
  getMentalModel,
} from "../memory/hindsight.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerDoctrineStatusTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tachikoma_doctrine_status",
    label: "Tachikoma: Doctrine Status",
    description:
      "List mental models in the doctrine bank with their last-refreshed timestamp and an is_stale flag. Use to verify which mental-model content is fresh before trusting it.",
    parameters: {} as Record<string, never>,
    async execute(_id: string, _params) {
      try {
        const session = getSession();
        const items = await listMentalModels({
          bank: "doctrine",
        });

        // For each model, fetch detail=full to get is_stale; gentle on failures.
        const enriched = await Promise.all(
          items.map(async (m) => {
            try {
              const full = await getMentalModel(m.id, {
                bank: "doctrine",
                detail: "full",
              });
              return {
                id: full.id,
                name: full.name,
                source_query_preview: (full.source_query ?? "").slice(0, 80),
                last_refreshed_at: full.last_refreshed_at,
                is_stale: full.is_stale ?? null,
                content_preview: (full.content ?? "").slice(0, 200),
                content_len: (full.content ?? "").length,
              };
            } catch (e) {
              return {
                id: m.id,
                name: m.name,
                error: (e as Error).message,
              };
            }
          }),
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { bank: session.config.hindsight.banks.doctrine, models: enriched },
                null,
                2,
              ),
            },
          ],
          details: { ok: true, error: false, count: enriched.length },
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `tachikoma_doctrine_status failed: ${(e as Error).message}`,
            },
          ],
          details: { ok: false, error: true, count: 0 },
        };
      }
    },
  });
}

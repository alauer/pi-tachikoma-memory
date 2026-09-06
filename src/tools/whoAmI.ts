/**
 * Tool: tachikoma_who_am_i
 *
 * Identity dump for debugging. Reports tickId, hostname, principal, message
 * count, insights retained, and the warm Mnemosyne context size.
 */

import { getSession } from "../state.js";
import { hostname as osHostname } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TachikomaMemoryError } from "../types.js";
import { mnemosyneStats } from "../memory/mnemosyne.js";

export function registerWhoAmITool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tachikoma_who_am_i",
    label: "Tachikoma: Who Am I?",
    description:
      "Report the current Tachikoma identity: tickId, hostname, active principal, message count, insights retained, Mnemosyne warm-context size, and bank assignments.",
    parameters: {} as Record<string, never>,
    async execute(_id: string, _params) {
      try {
        const session = getSession();
        const stats = await mnemosyneStats().catch(() => ({
          total: -1,
          working: -1,
          episodic: -1,
          triples: 0,
          banks: "?",
          dbPath: "?",
        }));

        const summary = {
          tickId: session.config.tickId,
          tachikomaNumber: session.config.tachikomaNumber,
          hostname: osHostname(),
          principal: session.principal,
          defaultPrincipal: session.config.principal.defaultPrincipal,
          messageCount: session.messageCount,
          insightCount: session.insightCount,
          lastSleepAt: session.lastSleepAt,
          identityHashKnown: session.identityHash || "(not yet loaded)",
          mnemosyneWarmChars: session.mnemosyneWarmContext.length,
          banks: {
            doctrine: session.config.hindsight.banks.doctrine,
            character: session.config.hindsight.banks.character,
          },
          mnemosyne: {
            bank: "(default)",
            dbPath: stats.dbPath,
            totalMemories: stats.total,
            workingMemory: stats.working,
            episodicMemory: stats.episodic,
          },
          startedAt: session.startedAt,
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(summary, null, 2) },
          ],
          details: { ok: true, error: false },
        };
      } catch (e) {
        const err = e as TachikomaMemoryError | Error;
        return {
          content: [
            {
              type: "text" as const,
              text: `tachikoma_who_am_i failed: ${err.message}`,
            },
          ],
          details: { ok: false, error: true },
        };
      }
    },
  });
}

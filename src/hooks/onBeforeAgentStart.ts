/**
 * `before_agent_start` hook — fires once per agent run (per user prompt).
 *
 * Responsibilities:
 *  - Modify the system prompt to append our three context blocks:
 *    1. tickMarker: small identity + principal line (always)
 *    2. identity-config: full IDENTITY/USER/SOUL.md joined (always when configured)
 *    3. mnemosyne-context: working-memory state from L1
 *
 * Pi's `before_agent_start` lets us replace/append the system prompt. We
 * append — we never overwrite user-provided system prompts.
 *
 * Each block is gated by `session.memoryBlocks` config so the user can
 * disable any of them.
 */

import { getSession } from "../state.js";
import { getIdentityBlock } from "../identity.js";
import { mnemosyneRecall } from "../memory/mnemosyne.js";
import { tickPrincipalLine, detectPrincipal } from "../principal.js";
import type {
  ExtensionAPI,
  BeforeAgentStartEvent,
  ExtensionHandler,
} from "@earendil-works/pi-coding-agent";

export function registerBeforeAgentStartHook(pi: ExtensionAPI): void {
  const handler = async (event: BeforeAgentStartEvent, _ctx: any) => {
    const session = getSession();

    // Re-detect principal from the user prompt text (no LLM call has happened yet)
    const principal = detectPrincipal(
      [{ role: "user", content: event.prompt }],
      {
        defaultPrincipal: session.config.principal.defaultPrincipal,
      },
    );
    if (principal !== session.principal) {
      session.principal = principal;
    }

    // Refresh Mnemosyne context (cheap; happens once per agent run)
    let mnemosyneContext = session.mnemosyneWarmContext ?? "";
    if (session.config.mnemosyne.autoInject.enabled) {
      try {
        const memories = await mnemosyneRecall({
          query: session.config.mnemosyne.autoInject.queryString,
          topK: session.config.mnemosyne.autoInject.topK,
        });
        mnemosyneContext = memories
          .map(
            (m, i) =>
              `${i + 1}. (id=${m.id.slice(0, 8)}, score=${m.score.toFixed(3)}) ${m.content}`,
          )
          .join("\n");
        session.mnemosyneWarmContext = mnemosyneContext;
      } catch {
        // keep cache
      }
    }

    // Identity block (cached; re-reads only on hash change)
    const identityContent = session.config.session.forceLoadIdentityFiles
      ? getIdentityBlock()
      : null;

    // Build blocks per config
    const blocks: string[] = [];
    if (session.config.session.memoryBlocks.includes("tickMarker")) {
      blocks.push(
        tickPrincipalLine(
          session.principal,
          session.config.tickId,
          session.config.tachikomaNumber,
        ),
      );
    }
    if (session.config.session.memoryBlocks.includes("identity") && identityContent) {
      blocks.push(`<identity-config>\n${identityContent}\n</identity-config>`);
    }
    if (
      session.config.session.memoryBlocks.includes("mnemosyne") &&
      mnemosyneContext
    ) {
      const userHint = event.prompt.slice(0, 40) ?? "(no recent user msg)";
      blocks.push(
        `<mnemosyne-context source="L1 mnemosyne · ${userHint}…">\n${mnemosyneContext}\n</mnemosyne-context>`,
      );
    }

    if (blocks.length === 0) return {};

    const extra = blocks.join("\n\n");
    return {
      systemPrompt: (event.systemPrompt ?? "") + "\n\n" + extra,
    };
  };

  pi.on("before_agent_start", handler);
}

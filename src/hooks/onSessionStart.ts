/**
 * `onSessionStart` hook handler.
 *
 * Responsibilities:
 *  - Initialize session state from config
 *  - Warm-load identity files (cached + hashed)
 *  - Warm-load Mnemosyne working-memory context for fast first-injection
 *  - Surface a startup notification so the agent knows the extension is live
 *
 * Returns nothing — Pi doesn't consume hook return values here.
 */

import { initSession, getSession } from "../state.js";
import { getIdentityBlock } from "../identity.js";
import { mnemosyneRecall } from "../memory/mnemosyne.js";
import { tickPrincipalLine } from "../principal.js";
import type { ExtensionAPI, SessionStartEvent } from "@earendil-works/pi-coding-agent";

export function registerSessionStartHook(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event: SessionStartEvent, ctx: any) => {
    // 1. Reset + initialize state from default.json
    const session = initSession();

    // 2. Warm-load identity block (cached and hashed)
    let identityBlock: string | null = null;
    if (session.config.session.forceLoadIdentityFiles) {
      try {
        identityBlock = getIdentityBlock();
      } catch (e) {
        ctx.ui.notify(`tachikoma-memory: identity load failed: ${(e as Error).message}`, "warning");
      }
    }

    // 3. Warm-load Mnemosyne working memory for first auto-inject.
    //    Best-effort: failure here doesn't break the session.
    let mnemosyneWarmContext = "";
    if (session.config.mnemosyne.autoInject.enabled) {
      try {
        const memories = await mnemosyneRecall({
          query: session.config.mnemosyne.autoInject.queryString,
          topK: session.config.mnemosyne.autoInject.topK,
        });
        mnemosyneWarmContext = memories
          .map(
            (m, i) =>
              `${i + 1}. (id=${m.id.slice(0, 8)}, score=${m.score.toFixed(3)}) ${m.content}`,
          )
          .join("\n");
      } catch (e) {
        ctx.ui.notify(
          `tachikoma-memory: Mnemosyne warm recall failed: ${(e as Error).message}`,
          "warning",
        );
      }
    }

    // 4. Stash the warmed context in state so onContext hook can use it without re-fetching
    //    (Mnemosyne updates happen in agent_end, where we refresh; first recall happens here)
    session.mnemosyneWarmContext = mnemosyneWarmContext;

    // 5. Startup notification — visible to the user but light
    if (ctx.hasUI) {
      ctx.ui.notify(
        `tachikoma-memory online · tickId=${session.config.tickId} · principal=${session.principal}`,
        "info",
      );
    }
    // Surface the tick marker to the log so debugging is easier
    console.log(
      tickPrincipalLine(session.principal, session.config.tickId, session.config.tachikomaNumber),
    );
  });
}

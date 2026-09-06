/**
 * `onAgentEnd` hook — fires when one agent run completes.
 *
 * Responsibilities:
 *  - Run LLM-driven insight extraction on the recent transcript
 *  - Retain extracted insights to Mnemosyne (L1)
 *  - Refresh the warm Mnemosyne context for the next agent run
 *  - Periodically run Mnemosyne `sleep()` for working → episodic consolidation
 *  - Increment insight counter; bump message count
 *
 * Silently no-ops if LLM is unavailable or Mnemosyne is unhealthy — never
 * throw on tool-call exit.
 */

import {
  getSession,
  bumpMessageCount,
  recordInsight,
  shouldSleep,
  markSlept,
} from "../state.js";
import { mnemosyneStore, mnemosyneRecall, mnemosyneSleep } from "../memory/mnemosyne.js";
import { extractInsights } from "../llm/extractInsights.js";
import type { ExtensionAPI, AgentEndEvent } from "@earendil-works/pi-coding-agent";

export function registerAgentEndHook(pi: ExtensionAPI): void {
  pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
    const session = getSession();
    const messages = Array.isArray(event.messages) ? event.messages : [];
    bumpMessageCount();

    // 1. LLM-driven insight extraction (best-effort)
    if (session.config.mnemosyne.retention.agentEndLlmExtractEnabled && messages.length > 0) {
      try {
        // Compact the transcript: last ~6 messages, plain text
        const recent = messages.slice(-6);
        const transcript = recent
          .map((m: any) => {
            const role = m?.role ?? "unknown";
            const text =
              typeof m?.content === "string"
                ? m.content
                : Array.isArray(m?.content)
                  ? m.content
                      .map((p: any) => (typeof p === "string" ? p : p?.text ?? ""))
                      .join(" ")
                  : JSON.stringify(m?.content ?? "");
            return `${role}: ${text}`.slice(0, 800);
          })
          .join("\n\n");

        const existing = await safeStats();

        const insights = await extractInsights(
          // ctx here is the agent's ExtensionContext. The extractor takes a minimal
          // surface so we wrap ctx lazily and tolerate absence of callLLM.
          {
            modelRegistry: ctx.modelRegistry
              ? { getAvailable: () => (ctx.modelRegistry as any).getAvailable?.() ?? [] }
              : undefined,
            callLLM: ctx.modelRegistry
              ? (args) =>
                  // The actual call-signature depends on Pi's runtime; treat as opaque.
                  (ctx.modelRegistry as any).runtime?.call?.(args) ??
                  Promise.resolve({ content: "[]" })
              : undefined,
          },
          {
            transcript,
            existingMnemosyne: { total: existing },
            minImportance: session.config.mnemosyne.retention.extractImportanceFloor,
          },
        );

        for (const insight of insights.insights) {
          try {
            await mnemosyneStore({
              content: insight.text,
              source: "agent-end-extract",
              importance: insight.importance,
            });
            recordInsight();
          } catch {
            // skip individual failures; keep going
          }
        }
      } catch (e) {
        // Extractor failures are non-fatal; carry on
        console.warn(`tachikoma-memory: extractor failed: ${(e as Error).message}`);
      }
    }

    // 2. Refresh Mnemosyne warm context so the next session start has fresh data
    try {
      const memories = await mnemosyneRecall({
        query: session.config.mnemosyne.autoInject.queryString,
        topK: session.config.mnemosyne.autoInject.topK,
      });
      session.mnemosyneWarmContext = memories
        .map(
          (m, i) =>
            `${i + 1}. (id=${m.id.slice(0, 8)}, score=${m.score.toFixed(3)}) ${m.content}`,
        )
        .join("\n");
    } catch {
      // keep stale cache on failure
    }

    // 3. Periodic sleep() if configured and overdue
    if (session.config.mnemosyne.sleep.onSessionEnd || shouldSleep()) {
      try {
        await mnemosyneSleep();
        markSlept();
      } catch {
        // non-fatal
      }
    }
  });
}

async function safeStats(): Promise<number> {
  try {
    const { mnemosyneStats } = await import("../memory/mnemosyne.js");
    return (await mnemosyneStats()).total;
  } catch {
    return 0;
  }
}

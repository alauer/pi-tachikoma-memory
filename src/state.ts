/**
 * Single-session state singleton.
 *
 * Pattern: a module-level mutable object. There's no async setup beyond
 * what `init()` does in `onSessionStart`. The state is process-local; it
 * does not persist across sessions.
 */

import type { Config, PrincipalName, SessionState } from "./types.js";
import { readConfig } from "./config.js";

let state: SessionState | null = null;

export function initSession(config?: Config): SessionState {
  const cfg = config ?? readConfig();
  state = {
    config: cfg,
    identityHash: "",
    identityContent: "",
    principal: cfg.principal.defaultPrincipal,
    messageCount: 0,
    lastSleepAt: 0,
    insightCount: 0,
    mnemosyneWarmContext: "",
    startedAt: new Date().toISOString(),
  };
  return state;
}

export function getSession(): SessionState {
  if (!state) {
    throw new Error("Session state not initialized — call initSession() in onSessionStart");
  }
  return state;
}

export function resetSession(): void {
  state = null;
}

// ─── Mutation helpers (typed and bounded) ────────────────────────────────────

export function setIdentityCache(hash: string, content: string): void {
  const s = getSession();
  s.identityHash = hash;
  s.identityContent = content;
}

export function setPrincipal(p: PrincipalName): PrincipalName {
  const s = getSession();
  const prev = s.principal;
  s.principal = p;
  if (prev !== p && s.config.principal.logSwitch) {
    console.log(`[tachikoma-memory] principal: ${prev} → ${p}`);
  }
  return p;
}

export function bumpMessageCount(): number {
  const s = getSession();
  return ++s.messageCount;
}

export function recordInsight(): number {
  const s = getSession();
  return ++s.insightCount;
}

export function shouldSleep(): boolean {
  const s = getSession();
  const every = s.config.mnemosyne.sleep.autoEveryMessages;
  if (every <= 0) return false;
  return s.messageCount - s.lastSleepAt >= every;
}

export function markSlept(): void {
  const s = getSession();
  s.lastSleepAt = s.messageCount;
}

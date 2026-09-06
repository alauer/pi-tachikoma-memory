/**
 * pi-tachikoma-memory extension — entry point.
 *
 * Loads the default config, installs lifecycle hooks, and registers tools.
 *
 * This extension is one of two Pi extensions for the Living Grid Tachikomas.
 * It coordinates Hindsight (L0 shared doctrine and L1 character banks) with
 * Mnemosyne (L1 personal/private memory) and exposes `tachikoma_*` tools.
 *
 * Pi loads this extension as ESM via jiti. The default export is the factory
 * that takes `ExtensionAPI`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSessionStartHook } from "./hooks/onSessionStart.js";
import { registerBeforeAgentStartHook } from "./hooks/onBeforeAgentStart.js";
import { registerAgentEndHook } from "./hooks/onAgentEnd.js";
import { registerWhoAmITool } from "./tools/whoAmI.js";
import { registerRecallAllTool } from "./tools/recallAll.js";
import { registerForceRefreshTool } from "./tools/forceRefresh.js";
import { registerDoctrineStatusTool } from "./tools/doctrineStatus.js";
import { registerMnemosynePassThroughTool } from "./tools/mnemosynePassThrough.js";

export default function tachikomaMemoryExtension(pi: ExtensionAPI): void {
  // ── Hooks ─────────────────────────────────────────────────────────────────
  registerSessionStartHook(pi);
  registerBeforeAgentStartHook(pi);
  registerAgentEndHook(pi);

  // ── Tools ─────────────────────────────────────────────────────────────────
  registerWhoAmITool(pi);
  registerRecallAllTool(pi);
  registerForceRefreshTool(pi);
  registerDoctrineStatusTool(pi);
  registerMnemosynePassThroughTool(pi);
}

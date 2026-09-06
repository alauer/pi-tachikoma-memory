/**
 * Smoke test for pi-tachikoma-memory.
 *
 * Loads the extension, registers hooks/tools against a mock ExtensionAPI,
 * invokes the whoAmI tool to verify the Hindsight + Mnemosyne paths actually work.
 *
 * Run with:  MNEMOSYNE_DATA_DIR=~/.hermes/mnemosyne/data/tako-2 npx tsx scripts/smoke.ts
 */

import { initSession } from "../src/state.js";

// Build a minimal mock ExtensionAPI — just the registration methods.
function buildMockApi() {
  const registered = { hooks: [], tools: [] as any[] } as {
    hooks: Array<{ event: string; handler: Function }>;
    tools: any[];
  };

  const api: any = {
    on(event: string, handler: Function) {
      registered.hooks.push({ event, handler });
    },
    registerTool(tool: any) {
      registered.tools.push(tool);
    },
    registerCommand() {
      /* skip */
    },
  };

  return { api, registered };
}

async function main() {
  console.log("=== pi-tachikoma-memory smoke test ===\n");

  // Pre-init session before the extension does (in case tools run before hooks)
  initSession();

  const { api, registered } = buildMockApi();
  const mod = await import("../src/index.js");
  mod.default(api);

  console.log(`Registered ${registered.hooks.length} hooks:`);
  for (const h of registered.hooks) console.log(`  - ${h.event}`);
  console.log(`Registered ${registered.tools.length} tools:`);
  for (const t of registered.tools) console.log(`  - ${t.name}`);

  // Find whoAmI tool and call it
  const whoAmI = registered.tools.find((t: any) => t.name === "tachikoma_who_am_i");
  if (!whoAmI) {
    console.error("FAIL: tachikoma_who_am_i not registered");
    process.exit(1);
  }

  console.log("\n=== Calling tachikoma_who_am_i ===");
  const result = await whoAmI.execute("test-id", {}, undefined, undefined, {
    ui: { notify: () => {} } as any,
    hasUI: true,
    mode: "print",
  } as any);
  console.log(result.content[0].text);
  console.log("\n=== Done ===");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});

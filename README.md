# pi-tachikoma-memory

> Unified memory layer for the **Living Grid Tachikomas**. Bridges [Hindsight](https://hindsight.vectorize.io/) (L0 doctrine + L1 character) and [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) (L1 personal) into the Pi agent's context with automatic injection and cross-layer recall.

A Pi extension package — installable from npm, git, or local path.

## What it solves

The Living Grid Tachikomas (Tachikoma-1, Tachikoma-2, future instances) need shared doctrine plus per-instance private continuity. The architecture is three layers:

| Layer | Source | Purpose |
|---|---|---|
| **L0 Doctrine** | Hindsight — `pi-coding`, `pi-aaron`, `tako-2-doctrine-test` | Shared canon (household rules, project conventions, mental models) |
| **L1 Character** | Hindsight `tako-2-character-test` + Mnemosyne per-instance db | Per-Tachikoma private observations |
| **L2 Working** | Pi context (auto-injected) | Identity, doctrine snapshot, Mnemosyne working memory |

This extension wires all three together for the Pi agent.

## Install

Prereqs:
- Pi ≥ 0.85
- A running Hindsight server (default: `http://localhost:8888`)
- `mnemosyne-memory` installed (`pip install mnemosyne-memory`)

```bash
# After publishing to npm (see Publishing below)
pi install npm:@alauer/pi-tachikoma-memory

# Or from git
pi install git:github.com/alauer/pi-tachikoma-memory@main

# Or local during development
pi install file:/home/aaron/Code/pi-tachikoma-memory
```

Then configure your banks. The default config points at `tako-2-doctrine-test` and `tako-2-character-test` Hindsight banks, plus `~/.hermes/mnemosyne/data/tako-2/` for Mnemosyne. To point at production (`pi-coding` and `pi-aaron`), edit `config/default.json` to taste.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Pi agent runtime                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  pi-tachikoma-memory extension                                  │   │
│  │                                                                 │   │
│  │  Hooks:                                                         │   │
│  │   • session_start       — initialize state, warm-load identity  │   │
│  │                          and Mnemosyne context                 │   │
│  │   • before_agent_start  — inject tick marker + identity       │   │
│  │                          + Mnemosyne into system prompt       │   │
│  │   • agent_end           — LLM-driven insight extraction →      │   │
│  │                          Mnemosyne retain; periodic sleep()    │   │
│  │                                                                 │   │
│  │  Tools:                                                         │   │
│  │   • tachikoma_who_am_i        — identity / state dump          │   │
│  │   • tachikoma_recall_all      — cross-layer ranked recall      │   │
│  │   • tachikoma_force_refresh   — guided refresh of stuck mental │   │
│  │                               models via PATCH source_query +    │   │
│  │                               refresh + await                   │   │
│  │   • tachikoma_doctrine_status — mental-model staleness report │   │
│  │   • tachikoma_mnemosyne       — L1 pass-through               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Backends                                                              │
│  ┌──────────────────────┐  ┌─────────────────────────────────────────┐  │
│  │ Hindsight REST API    │  │ Mnemosyne CLI (subprocess)             │  │
│  │ (Postgres + pgvector)│  │ (SQLite + sqlite-vec at ~/.hermes/...)  │  │
│  └──────────────────────┘  └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Test banks (verified working as of v0.1.0)

| Bank | URL | Notes |
|---|---|---|
| `tako-2-doctrine-test` | `http://192.168.11.14:8888/v1/default/banks/tako-2-doctrine-test` | Layer-0 shared doctrine |
| `tako-2-character-test` | `http://192.168.11.14:8888/v1/default/banks/tako-2-character-test` | Layer-1 per-Tachikoma character bank |
| (Mnemosyne) | `~/.hermes/mnemosyne/data/tako-2/mnemosyne.db` | Layer-1 per-Tachikoma private memory |

These are isolated from production. They exist solely for the Tachikoma-2 test instance.

## Mental-model pitfalls (read this before using `tachikoma_force_refresh`)

**Hindsight doesn't allow force-writing mental-model content.** The `PATCH /mental-models/{id}` endpoint accepts only `name`, `source_query`, `max_tokens`, `tags`, `trigger` — not `current_content`. Attempting to PATCH with `content` is silently ignored.

The workaround used by `tachikoma_force_refresh`:
1. PATCH the `source_query` to a tight hint about what the content should be
2. POST `/mental-models/{id}/refresh` to trigger reflect
3. Poll the operation until terminal
4. Fetch `detail=full` to get the new content

If reflect doesn't produce the content you want, refine the `content_hint` argument and call refresh again. Each call costs an LLM token.

Some mental models in Hindsight can stay stuck on "I don't have information" if reflect can't find relevant facts in the bank. To avoid this, **bootstrap mental models with `source_query` that retrieves their own existing content**, or seed the bank with at least one related fact before refresh.

## Configuration

Edit `config/default.json`:

```jsonc
{
  "tickId": "tachikoma-2",
  "tachikomaNumber": 2,
  "hindsight": {
    "baseUrl": "http://localhost:8888",
    "banks": {
      "doctrine": "pi-coding",           // or "tako-2-doctrine-test" during testing
      "character": "pi-aaron"            // or "tako-2-character-test" during testing
    },
    "explain": true,
    "defaultTopK": 8
  },
  "mnemosyne": {
    "dataDir": "~/.hermes/mnemosyne/data/tako-2",
    "autoInject": { "enabled": true, "topK": 8, "queryString": "..." },
    "retention": {
      "toolExtractEnabled": true,
      "agentEndLlmExtractEnabled": true,
      "extractImportanceFloor": 0.55
    },
    "sleep": { "autoEveryMessages": 25, "onSessionEnd": true }
  },
  "session": {
    "autoMentionIdentity": true,
    "forceLoadIdentityFiles": true,
    "memoryBlocks": ["tickMarker", "identity", "mnemosyne"]
  }
}
```

The Pi agent expects this file to be at `<package>/config/default.json` next to the built `dist/index.js`.

## Development

```bash
cd ~/Code/pi-tachikoma-memory
npm install
npx tsc --noEmit          # typecheck
npx tsc                   # build (writes dist/)
npx tsx scripts/smoke.ts  # end-to-end smoke test
```

The smoke test loads the extension against a mock Pi `ExtensionAPI` and runs `tachikoma_who_am_i` end-to-end. It connects to your real Hindsight server (per `HINDSIGHT_BASE_URL` env var or default) and real Mnemosyne CLI.

### Repo layout

```
pi-tachikoma-memory/
├── package.json
├── tsconfig.json
├── .gitignore
├── config/
│   └── default.json       # shipped config; user can override per session
├── src/
│   ├── index.ts           # extension entry point
│   ├── types.ts           # Config, SessionState, Hindsight + Mnemosyne types
│   ├── state.ts           # session state singleton
│   ├── config.ts          # reads config/default.json
│   ├── identity.ts        # reads ~/.0xkobold/{IDENTITY,USER,SOUL}.md
│   ├── principal.ts       # Aaron vs Jeeves detection
│   ├── memory/
│   │   ├── hindsight.ts   # Hindsight REST API client
│   │   ├── mnemosyne.ts   # Mnemosyne CLI subprocess wrapper
│   │   └── formats.ts     # cross-layer and Mnemosyne output formatters
│   ├── hooks/
│   │   ├── onSessionStart.ts
│   │   ├── onBeforeAgentStart.ts
│   │   └── onAgentEnd.ts
│   ├── tools/
│   │   ├── whoAmI.ts
│   │   ├── recallAll.ts
│   │   ├── forceRefresh.ts
│   │   ├── doctrineStatus.ts
│   │   └── mnemosynePassThrough.ts
│   └── llm/
│       └── extractInsights.ts   # agent_end LLM extraction
├── scripts/
│   └── smoke.ts           # end-to-end smoke
└── README.md
```

## Architectural notes

### Why no `pi.on("context")` hook for auto-injection

Pi's `context` event lets you modify the `messages` array. But AgentMessage types don't include a `SystemMessage` variant — that's not part of the `Message` union from `@earendil-works/pi-ai`. You can't append a new "system" message that the LLM would accept.

Instead, `before_agent_start` returns `{ systemPrompt: ... }` which appends text to the assembled system prompt string. That's the right place for persistent context.

### Why `force_refresh` doesn't truly "force-write"

See "Mental-model pitfalls" above. Hindsight's mental-model update endpoint doesn't accept `current_content`. We route through reflect via `source_query` PATCH instead. The result is "guided force-refresh" — close, but not literally a content overwrite.

### Subagents unavailable in current Pi install

This build was authored under direct agent execution because the Pi `subagent` tool requires `@earendil-works/pi-server` and `@earendil-works/pi-client/unix` which aren't bundled in this install. Once those are available, parallel subagent authoring is straightforward — each piece of the extension is well-scoped.

## Publishing

```bash
# From a fresh checkout
npm version patch
git tag v0.x.y
git push origin main --tags
# Pi install consumes from npm:
pi install npm:@alauer/pi-tachikoma-memory@0.x.y
```

## License

MIT, same as Mnemosyne and Hindsight.

## Related projects

- [Hindsight](https://github.com/vectorize-io/hindsight) — `alauer/pi-tachikoma-memory` is in `[alauer]'s GitHub` org but is independent of vectorize-io/hindsight.
- [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) — the L1 personal memory store this extension proxies to.
- [Pi](https://pi.dev) — the agent runtime; this is a Pi extension.

---

For the Living Grid Tachikomas. 🧡🔥

/**
 * LLM-driven insight extractor for `agent_end` retention.
 *
 * Called on each agent_end to extract durable preferences, project rules, and
 * workflow patterns from the recent transcript. Returns a small set of
 * structured insights that the caller can retain to Mnemosyne (L1).
 *
 * Design notes:
 * - Uses a small model (first available from Pi's modelRegistry); assumed to be
 *   capable of structured JSON output.
 * - Returns `{insights: []}` on any failure (no LLM, parse error, invalid rows).
 *   The caller decides whether to retain them.
 * - Cheap: max_tokens=1024 default, system prompt short.
 */

import type { ExtractedInsight, ExtractionResult } from "../types.js";

// ─── Context shape ────────────────────────────────────────────────────────

/**
 * A minimal context surface needed by this module. The real Pi hook passes
 * `ExtensionContext`; we accept the subset that matters here so this module
 * is also testable with a fake.
 */
export interface ExtractionContext {
  modelRegistry?: {
    getAvailable?: () => Array<{ provider: string; id: string }>;
  };
  callLLM?: (args: {
    model: { provider: string; id: string };
    messages: Array<{ role: "system" | "user"; content: string }>;
    maxTokens?: number;
    signal?: AbortSignal;
  }) => Promise<{ content: string; usage?: { inputTokens?: number; outputTokens?: number } }>;
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface ExtractInsightsOpts {
  transcript: string; // pre-formatted recent assistant+user messages
  existingMnemosyne?: { total: number }; // counts only (signal to LLM)
  minImportance?: number; // default 0.5
  maxInsights?: number; // default 5
}

export async function extractInsights(
  ctx: ExtractionContext,
  opts: ExtractInsightsOpts,
): Promise<ExtractionResult> {
  const minImp = opts.minImportance ?? 0.5;
  const maxItems = opts.maxInsights ?? 5;

  // Fail-soft: no model available → empty result, no throw
  const callLLM = ctx.callLLM;
  const models = ctx.modelRegistry?.getAvailable?.() ?? [];
  if (!callLLM || models.length === 0) {
    return { insights: [] };
  }
  const model = models[0]!;

  const existingCount = opts.existingMnemosyne?.total ?? 0;
  const systemPrompt = buildSystemPrompt({ existingCount, minImportance: minImp, maxInsights: maxItems });
  const userPrompt = opts.transcript;

  let raw: { content: string; usage?: { inputTokens?: number; outputTokens?: number } };
  try {
    raw = await callLLM({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 1024,
    });
  } catch {
    return { insights: [] };
  }

  const parsed = safeParseJsonArray(raw.content);
  if (!parsed) return { insights: [] };

  const insights: ExtractedInsight[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;

    const text = typeof r.text === "string" ? r.text.trim() : "";
    const rationale = typeof r.rationale === "string" ? r.rationale.trim() : "";
    const rawImportance = r.importance;

    if (!text) continue;
    let importance: number = typeof rawImportance === "number" ? rawImportance : NaN;
    if (!Number.isFinite(importance)) continue;
    if (importance < 0) importance = 0;
    if (importance > 1) importance = 1;
    if (importance < minImp) continue;

    const out: ExtractedInsight = { text, importance, rationale };
    if (Array.isArray(r.tags) && r.tags.every((t) => typeof t === "string")) {
      out.tags = r.tags as string[];
    }
    insights.push(out);

    if (insights.length >= maxItems) break;
  }

  return {
    insights,
    usage: raw.usage,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_TEMPLATE = `You are a privacy-aware memory extractor for a long-running AI agent.

Goal: extract DURABLE preferences, project rules, workflow patterns, personal facts, and standing instructions that should be remembered for FUTURE sessions.

Constraints:
- Do NOT extract greetings, acknowledgments ("ok", "thanks", "got it"), transient status, tool output, debugging output, system instructions.
- Do NOT write anything already covered by what the memory store already holds (see existing count).
- importance must be a number in [0.5, 1.0]. Higher = more durable.
- Return AT MOST {{MAX_INSIGHTS}} insights.
- importance < {{MIN_IMPORTANCE}}: do not return.
- Output ONLY a JSON array. No prose. No markdown fences unless the array is inside a single \`\`\`json ... \`\`\` block.

Each row shape:
{"text": string, "importance": number, "rationale": string, "tags": string[]?}

Examples of "important enough to keep":
- User-stated preferences ("I prefer X", "always use Y", "never do Z")
- Project rules that constrain future work ("we don't ship that", "this repo uses Y")
- Workflow patterns ("when X, do Y; when Z, escalate")
- Long-lived facts about the user, family, relationships, household

Examples of "not worth keeping":
- "ok"
- status from a tool call
- one-off question content
- speculative content
- LLM-internal reasoning that doesn't represent user intent

`;

/**
 * Build a system prompt with template substitution. Uses double-curly braces
 * so embedded JSON braces in the rest of the prompt don't need escaping.
 */
function buildSystemPrompt(ctx: { existingCount: number; minImportance: number; maxInsights: number }): string {
  return SYSTEM_PROMPT_TEMPLATE.replace("{{MAX_INSIGHTS}}", String(ctx.maxInsights))
    .replace("{{MIN_IMPORTANCE}}", String(ctx.minImportance))
    .replace(
      "what the memory store already holds (see existing count).",
      `what the memory store already holds (current count: ${ctx.existingCount}).`,
    );
}

/**
 * Parse a JSON array from model output, tolerating markdown fences and minor
 * malformed input. Returns null if no array is found or parsing fails.
 */
function safeParseJsonArray(s: string): unknown[] | null {
  // Direct parse
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
  } catch {
    /* fallthrough */
  }

  // Strip ```json ... ``` (or generic ```) fences
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  if (fenced) {
    try {
      const v = JSON.parse(fenced[1]!.trim());
      if (Array.isArray(v)) return v;
    } catch {
      /* fallthrough */
    }
  }

  // Find the first `[...]` substring and try to parse
  const firstBracket = s.indexOf("[");
  const lastBracket = s.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const slice = s.slice(firstBracket, lastBracket + 1);
    try {
      const v = JSON.parse(slice);
      if (Array.isArray(v)) return v;
    } catch {
      /* swallow */
    }
  }
  return null;
}

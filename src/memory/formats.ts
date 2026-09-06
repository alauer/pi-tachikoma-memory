/**
 * Formatting helpers for the cross-layer recall output.
 *
 * Tachikoma tools that return results to the LLM use these helpers
 * for shape consistency. The LLM gets ranked, provenanced, layer-tagged
 * facts — never raw JSON dumps.
 */

import type { CrossLayerFact, CrossLayerRecallResult, LayerName } from "../types.js";

/**
 * Format a list of cross-layer facts for display to the LLM.
 * Layers are grouped; within a layer, facts are sorted by descending score.
 */
export function formatCrossLayerResults(result: CrossLayerRecallResult): string {
  const layers: Record<LayerName, CrossLayerFact[]> = {
    "L0:doctrine": [],
    "L1:character": [],
    "L1:mnemosyne": [],
  };

  for (const f of result.facts) {
    if (!layers[f.layer]) continue;
    layers[f.layer].push(f);
  }

  const lines: string[] = [];
  lines.push(`Cross-layer recall results for: "${result.query}"`);
  lines.push(`Layers queried: ${result.layersQueried.join(", ") || "(none)"}`);
  lines.push(`Results: ${result.facts.length}`);
  lines.push("");

  for (const layer of Object.keys(layers) as LayerName[]) {
    const facts = layers[layer];
    if (facts.length === 0) continue;
    lines.push(`── ${layer} (${facts.length}) ──`);
    for (const f of facts.slice(0, 8)) {
      lines.push(`  • [${f.sourceId.slice(0, 8)}] (${f.factType ?? "fact"}) ${f.text.slice(0, 240)}`);
      if (f.similarity != null) {
        lines.push(`    sim=${f.similarity.toFixed(3)}${f.armedSource ? ` arm=${f.armedSource}` : ""}`);
      } else if (f.importance != null) {
        lines.push(`    importance=${f.importance.toFixed(3)}`);
      }
      lines.push(`    confidence=${f.confidence}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Strip Mnemosyne's text-formatting wrapper from its CLI output, leaving only
 * the structured content.
 *
 * Mnemosyne CLI prints blocks like:
 *
 *   Results for: sentinel
 *
 *     ID: a059bd9350b6127e
 *     Content: Tachikoma-2 initial sentinel
 *     Score: 0.583
 *
 * Returns the inner body so the parser can extract fields line-by-line.
 */
export function stripMnemosyneHeader(output: string): string {
  // Mnemosyne prepends "Results for: <query>\n" or similar. Cut at the first
  // line that looks like a field header ("ID:" / "  ID:") or by stripping the
  // leading query echo.
  const lines = output.split("\n");
  const trimmed: string[] = [];
  let seen = false;
  for (const line of lines) {
    const idMatch = /^[ \t]*(?:Results for:|ID:|  ID:|Content:|Score:)/.test(line);
    if (idMatch) {
      seen = true;
    }
    if (seen) trimmed.push(line);
  }
  return trimmed.length > 0 ? trimmed.join("\n") : output;
}

/**
 * Parse Mnemosyne's CLI output into structured memory items.
 * Returns [] if no items are detected. Robust to missing fields.
 */
export function parseMnemosyneRecall(output: string): Array<{
  id: string;
  content: string;
  score: number;
  importance?: number;
  fact_type?: string;
  source?: string;
  created_at?: string;
}> {
  const stripped = stripMnemosyneHeader(output);
  const items: Array<{
    id: string;
    content: string;
    score: number;
    importance?: number;
    fact_type?: string;
    source?: string;
    created_at?: string;
  }> = [];

  let current: Partial<{
    id: string;
    content: string;
    score: number;
    importance: number;
    fact_type: string;
    source: string;
    created_at: string;
  }> | null = null;

  for (const raw of stripped.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (current?.id) {
        items.push(current as { id: string; content: string; score: number });
        current = null;
      }
      continue;
    }
    const idMatch = /^[ \t]*(?:Results for:|ID:)\s*(.+?)\s*$/.exec(line);
    const contentMatch = /^[ \t]*Content:\s*(.+?)\s*$/.exec(line);
    const scoreMatch = /^[ \t]*Score:\s*([0-9.]+)\s*$/.exec(line);
    const importanceMatch = /^[ \t]*(?:Importance|importance):\s*([0-9.]+)\s*$/.exec(line);
    const factTypeMatch = /^[ \t]*(?:Type|fact_type):\s*(\S+)\s*$/.exec(line);
    const sourceMatch = /^[ \t]*(?:Source|source):\s*(.+?)\s*$/.exec(line);
    const createdAtMatch = /^[ \t]*(?:Created at|created_at):\s*(.+?)\s*$/.exec(line);

    if (idMatch) {
      // Push the previous (if any) and start a new record.
      if (current?.id) items.push(current as { id: string; content: string; score: number });
      current = { id: idMatch[1] };
      continue;
    }
    if (!current) continue;
    if (contentMatch) current.content = contentMatch[1];
    else if (scoreMatch) current.score = parseFloat(scoreMatch[1]);
    else if (importanceMatch) current.importance = parseFloat(importanceMatch[1]);
    else if (factTypeMatch) current.fact_type = factTypeMatch[1];
    else if (sourceMatch) current.source = sourceMatch[1];
    else if (createdAtMatch) current.created_at = createdAtMatch[1];
  }
  if (current?.id) {
    items.push(current as { id: string; content: string; score: number });
  }
  return items;
}

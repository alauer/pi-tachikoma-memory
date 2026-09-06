/**
 * Tool: tachikoma_recall_all
 *
 * Cross-layer recall across the configured banks (default both doctrine +
 * character) plus Mnemosyne (L1). Returns ranked, provenanced facts.
 *
 * Each fact carries a `layer` label and an `arm` / `armedSource` where
 * applicable so the agent can see which surface it came from. Rankings are
 * by the layer's native scoring; cross-layer order is preserved as provided
 * to the formatter.
 */

import { getSession } from "../state.js";
import { recall as hindsightRecall } from "../memory/hindsight.js";
import { mnemosyneRecall } from "../memory/mnemosyne.js";
import { formatCrossLayerResults } from "../memory/formats.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  CrossLayerFact,
  CrossLayerRecallResult,
  LayerName,
  HindsightMemoryFact,
} from "../types.js";

interface LayerOpts {
  doctrine?: boolean;
  character?: boolean;
  mnemosyne?: boolean;
}

export function registerRecallAllTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tachikoma_recall_all",
    label: "Tachikoma: Cross-Layer Recall",
    description:
      "Recall across Hindsight (L0 doctrine and L1 character banks) and Mnemosyne (L1 personal) in one call. Returns ranked, layer-tagged facts. Useful when verifying doctrine or building a complete picture across layers.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string.",
        },
        top_k: {
          type: "number",
          description: "Per-layer top-K; default 8.",
        },
        layers: {
          type: "array",
          items: { type: "string" },
          description:
            "Which layers to query. Defaults to all three. Items: 'doctrine', 'character', 'mnemosyne'.",
        },
        fact_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Hindsight fact type filter: 'world', 'experience', 'observation'.",
        },
      },
      required: ["query"],
    } as Record<string, unknown>,
    async execute(_id: string, params) {
      const p = params as {
        query: string;
        top_k?: number;
        layers?: string[];
        fact_types?: Array<"world" | "experience" | "observation">;
      };
      const topK = p.top_k ?? 8;
      const layerOpts: LayerOpts = {
        doctrine: !p.layers || p.layers.includes("doctrine"),
        character: !p.layers || p.layers.includes("character"),
        mnemosyne: !p.layers || p.layers.includes("mnemosyne"),
      };

      const session = getSession();
      const facts: CrossLayerFact[] = [];
      const layersQueried: LayerName[] = [];

      // Hindsight: doctrine
      if (layerOpts.doctrine) {
        try {
          const r = await hindsightRecall(
            {
              query: p.query,
              top_k: topK,
              fact_types: p.fact_types,
              explain: true,
            },
            { bank: "doctrine" },
          );
          for (const fact of r.results ?? []) {
            facts.push(hindsightFactToCrossLayer(fact, "L0:doctrine"));
          }
          layersQueried.push("L0:doctrine");
        } catch {
          /* skip */
        }
      }

      // Hindsight: character
      if (layerOpts.character) {
        try {
          const r = await hindsightRecall(
            {
              query: p.query,
              top_k: topK,
              fact_types: p.fact_types,
              explain: true,
            },
            { bank: "character" },
          );
          for (const fact of r.results ?? []) {
            facts.push(hindsightFactToCrossLayer(fact, "L1:character"));
          }
          layersQueried.push("L1:character");
        } catch {
          /* skip */
        }
      }

      // Mnemosyne
      if (layerOpts.mnemosyne) {
        try {
          const memories = await mnemosyneRecall({
            query: p.query,
            topK: topK,
          });
          for (const m of memories) {
            facts.push({
              layer: "L1:mnemosyne",
              text: m.content,
              sourceId: m.id,
              factType: m.fact_type,
              similarity: m.score,
              freshness: m.created_at ?? new Date().toISOString(),
              importance: m.importance,
              confidence: "medium (personal)",
            });
          }
          layersQueried.push("L1:mnemosyne");
        } catch {
          /* skip */
        }
      }

      const result: CrossLayerRecallResult = {
        query: p.query,
        facts,
        layersQueried,
        fetchedAt: new Date().toISOString(),
        freshBlock: "memory_modeling",
      };

      return {
        content: [
          { type: "text" as const, text: formatCrossLayerResults(result) },
        ],
        details: { count: facts.length, layers: layersQueried },
      };
    },
  });
}

function hindsightFactToCrossLayer(
  fact: HindsightMemoryFact,
  layer: LayerName,
): CrossLayerFact {
  // Determine arm from arm_scores if present
  let armedSource: string | undefined;
  if (fact.arm_scores) {
    if (typeof fact.arm_scores.semantic === "number") armedSource = "semantic";
    else if (typeof fact.arm_scores.keyword === "number") armedSource = "bm25";
    else if (typeof fact.arm_scores.graph === "number") armedSource = "graph";
    else if (typeof fact.arm_scores.temporal === "number") armedSource = "temporal";
  }

  return {
    layer,
    text: String(fact.text ?? ""),
    sourceId: String(fact.id ?? ""),
    factType: fact.fact_type,
    similarity: typeof fact.similarity === "number" ? fact.similarity : null,
    rerankerScore: typeof fact.reranker_score === "number" ? fact.reranker_score : null,
    armedSource,
    freshness: typeof fact.metadata?.["occurred_start"] === "string"
      ? (fact.metadata["occurred_start"] as string)
      : new Date().toISOString(),
    confidence: layer === "L0:doctrine" ? "high (canon)" : "medium (personal)",
  };
}

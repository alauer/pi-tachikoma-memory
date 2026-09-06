/**
 * Core type definitions for the pi-tachikoma-memory extension.
 *
 * Config mirrors config/default.json; SessionState is per-process runtime.
 */

import type { Static } from "typebox";

// ─── Config (parsed from config/default.json) ────────────────────────────────

export type TickId = string;          // e.g. "tachikoma-2"
export type TachikomaNumber = number; // 1, 2, 3, ...

export interface HindsightConfig {
  baseUrl: string;
  banks: {
    doctrine: string;  // bank_id for shared doctrine layer (L0)
    character: string;  // bank_id for personal character layer (L1)
  };
  explain: boolean;
  includeChunks: boolean;
  defaultTopK: number;
}

export interface MnemosyneAutoInjectConfig {
  enabled: boolean;
  topK: number;
  queryString: string; // what to pass to `mnemosyne recall` for the per-LLM-call auto-inject
}

export interface MnemosyneRetentionConfig {
  toolExtractEnabled: boolean;
  agentEndLlmExtractEnabled: boolean;
  extractImportanceFloor: number;     // 0.0–1.0; below this we don't keep
  minContentLengthForExtract: number; // chars; smaller outputs are no-ops
}

export interface MnemosyneSleepConfig {
  autoEveryMessages: number;          // run sleep() every N messages; 0 disables
  onSessionEnd: boolean;
}

export interface MnemosyneConfig {
  dataDir: string;     // e.g. "~/.hermes/mnemosyne/data/tako-2"
  cliBinary: string;   // usually just "mnemosyne"
  autoInject: MnemosyneAutoInjectConfig;
  retention: MnemosyneRetentionConfig;
  sleep: MnemosyneSleepConfig;
}

export interface SessionConfig {
  autoMentionIdentity: boolean;
  forceLoadIdentityFiles: boolean;
  refreshIdentityOnHashChange: boolean;
  memoryBlocks: Array<"tickMarker" | "identity" | "mnemosyne">;
}

export interface PrincipalConfig {
  defaultPrincipal: "aaron" | "jeeves";
  logSwitch: boolean;
}

export interface Config {
  tickId: TickId;
  tachikomaNumber: TachikomaNumber;
  hindsight: HindsightConfig;
  mnemosyne: MnemosyneConfig;
  session: SessionConfig;
  principal: PrincipalConfig;
}

// ─── Runtime types (NOT in Config — built per session) ─────────────────────

export type PrincipalName = "aaron" | "jeeves" | "unknown";

export interface IdentitySnapshot {
  hash: string;                 // combined sha256 first-16 of all three files
  content: string;              // concatenated IDENTITY/USER/SOUL rendered as one block
  files: {
    identity: { path: string; hash: string; content: string };
    user: { path: string; hash: string; content: string };
    soul: { path: string; hash: string; content: string };
  };
  fetchedAt: string;            // ISO timestamp
}

export interface SessionState {
  config: Config;
  identityHash: string;          // last seen hash (for change detection)
  identityContent: string;       // cached identity block content
  principal: PrincipalName;
  messageCount: number;
  lastSleepAt: number;           // messageCount at last mnemosyne sleep
  insightCount: number;          // # of insights retained to mnemosyne this session
  startedAt: string;             // ISO
}

// ─── Hindsight response shapes (subset — only what we parse) ───────────────

export interface HindsightMentalModel {
  id: string;
  bank_id: string;
  name: string;
  source_query?: string | null;
  content?: string | null;
  tags?: string[];
  max_tokens?: number | null;
  trigger?: unknown;
  last_refreshed_at?: string | null;
  created_at?: string | null;
  is_stale?: boolean | null;
}

export interface HindsightMentalModelListItem {
  id: string;
  name: string;
  tags?: string[];
  last_refreshed_at?: string | null;
  is_stale?: boolean | null;
}

export interface HindsightMemoryFact {
  id: string;
  text: string;
  fact_type?: string;
  context?: string | null;
  tags?: string[];
  metadata?: Record<string, string>;
  similarity?: number | null;
  reranker_score?: number | null;
  arm_scores?: Record<string, number>;
  [k: string]: unknown;
}

export interface HindsightRecallResult {
  query: string;
  results: HindsightMemoryFact[];
  // explain mode adds:
  arm_scores?: Record<string, number>;
  source_ranks?: Record<string, number>;
  [k: string]: unknown;
}

export interface HindsightOperation {
  operation_id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled" | string;
  operation_type?: string;
  [k: string]: unknown;
}

// ─── Mnemosyne types (parsed from CLI text output) ─────────────────────────

export interface MnemosyneMemory {
  id: string;
  content: string;
  score: number;
  // Mnemosyne CLI prints more fields; we capture the useful ones
  importance?: number;
  fact_type?: string;
  created_at?: string;
  source?: string;
}

export interface MnemosyneStats {
  total: number;
  working: number;
  episodic: number;
  triples: number;
  banks: string;
  dbPath: string;
}

// ─── Cross-layer result types (used by recallAll tool) ─────────────────────

export type LayerName =
  | "L0:doctrine"
  | "L1:character"
  | "L1:mnemosyne";

export interface CrossLayerFact {
  layer: LayerName;
  text: string;
  sourceId: string;
  factType?: string;
  similarity?: number | null;
  rerankerScore?: number | null;
  armedSource?: string; // "semantic" | "bm25" | "graph" | "temporal"
  freshness: string;    // ISO timestamp
  importance?: number;
  confidence: "high (canon)" | "medium (personal)"; // per-layer default
}

export interface CrossLayerRecallResult {
  query: string;
  facts: CrossLayerFact[];
  layersQueried: LayerName[];
  fetchedAt: string;
  freshBlock: "memory_modeling";   // for mental model context use
}

// ─── LLM extractor types ──────────────────────────────────────────────────

export interface ExtractedInsight {
  text: string;
  importance: number; // 0.0-1.0
  rationale: string;  // why this is worth remembering
  tags?: string[];
}

export interface ExtractionResult {
  insights: ExtractedInsight[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

// ─── Error class ─────────────────────────────────────────────────────────

export class TachikomaMemoryError extends Error {
  constructor(message: string, public readonly source: "hindsight" | "mnemosyne" | "config" | "internal" = "internal") {
    super(message);
    this.name = "TachikomaMemoryError";
  }
}

/**
 * Hindsight HTTP client.
 *
 * Wraps the v0.8.4 Hindsight REST API surface the extension actually uses:
 *   - Bank creation/read/update
 *   - Memory retain / recall
 *   - Mental model create / get / update / refresh
 *   - Operation status polling
 *
 * All requests go through `fetch`; no SDK dependency.
 *
 * Errors thrown by Hindsight are normalized to `TachikomaMemoryError` with
 * `source: "hindsight"` so callers can distinguish from internal/Mnemosyne errors.
 */

import { getSession } from "../state.js";
import { TachikomaMemoryError } from "../types.js";
import type {
  HindsightMentalModel,
  HindsightMemoryFact,
  HindsightOperation,
  HindsightRecallResult,
} from "../types.js";

interface ClientOpts {
  baseUrl?: string;
  bankId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function getBaseUrl(): string {
  return getSession().config.hindsight.baseUrl;
}

function pickBank(opts: { bank?: "doctrine" | "character" | string }): string {
  const cfg = getSession().config.hindsight.banks;
  if (opts.bank === "character" || opts.bank === "doctrine") {
    return cfg[opts.bank];
  }
  if (opts.bank) return opts.bank;
  // Default: doctrine bank (shared canon)
  return cfg.doctrine;
}

async function call<T>(
  opts: ClientOpts & { method: string; path: string; body?: unknown },
): Promise<T> {
  const baseUrl = opts.baseUrl ?? getBaseUrl();
  const url = `${baseUrl.replace(/\/$/, "")}${opts.path}`;
  const fetcher = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timeout = opts.timeoutMs ?? 10_000;
  const timer = setTimeout(() => ctrl.abort(), timeout);

  let res: Response;
  try {
    res = await fetcher(url, {
      method: opts.method,
      headers: {
        "Content-Type": "application/json",
        ...(opts.body ? { "Content-Length": String(JSON.stringify(opts.body).length) } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new TachikomaMemoryError(
      `Hindsight ${opts.method} ${opts.path} failed: ${(e as Error).message}`,
      "hindsight",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new TachikomaMemoryError(
      `Hindsight ${opts.method} ${opts.path} → ${res.status}: ${detail.slice(0, 300)}`,
      "hindsight",
    );
  }

  // Some endpoints (refresh, retain) return queued operations; if the body
  // starts with `{` we JSON-parse, otherwise pass through text.
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

// ─── Banks ─────────────────────────────────────────────────────────────────

export async function createBank(
  bankId: string,
  payload: { name: string; mission?: string },
  opts: { baseUrl?: string } = {},
): Promise<{ bank_id: string; name: string; mission?: string }> {
  return call({
    baseUrl: opts.baseUrl,
    method: "PUT",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}`,
    body: payload,
    bankId,
  });
}

export async function getBank(
  bankId: string,
  opts: { baseUrl?: string } = {},
): Promise<unknown> {
  return call({
    baseUrl: opts.baseUrl,
    method: "GET",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}`,
    bankId,
  });
}

// ─── Memory: retain / recall ──────────────────────────────────────────────

export interface RetainRequest {
  content: string;
  context?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  document_id?: string;
  entities?: Array<{ text: string; type?: string }>;
  extract_entities?: boolean;
  async_mode?: boolean;
  event_date?: string;
  bank?: "doctrine" | "character" | string;
}

export async function retain(
  payload: RetainRequest,
  opts: { bank?: "doctrine" | "character" | string; baseUrl?: string } = {},
): Promise<HindsightOperation> {
  const bankId = pickBank({ bank: opts.bank });
  const { bank: _, ...body } = payload;
  return call<HindsightOperation>({
    baseUrl: opts.baseUrl,
    method: "POST",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}/memories`,
    body,
    bankId,
  });
}

export interface RecallRequest {
  query: string;
  top_k?: number;
  fact_types?: Array<"world" | "experience" | "observation">;
  tags?: string[];
  tag_match?: "any" | "all";
  include_chunks?: boolean;
  explain?: boolean;
  bank?: "doctrine" | "character" | string;
}

export async function recall(
  payload: RecallRequest,
  opts: { bank?: "doctrine" | "character" | string; baseUrl?: string } = {},
): Promise<HindsightRecallResult> {
  const bankId = pickBank({ bank: opts.bank });
  const cfg = getSession().config.hindsight;
  return call<HindsightRecallResult>({
    baseUrl: opts.baseUrl,
    method: "POST",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`,
    body: {
      query: payload.query,
      top_k: payload.top_k ?? cfg.defaultTopK,
      fact_types: payload.fact_types,
      tags: payload.tags,
      tag_match: payload.tag_match,
      include_chunks: payload.include_chunks ?? cfg.includeChunks,
      explain: payload.explain ?? cfg.explain,
    },
    bankId,
  });
}

// ─── Mental models ────────────────────────────────────────────────────────

export interface MentalModelCreate {
  id?: string;
  name: string;
  source_query: string;
  tags?: string[];
  max_tokens?: number;
  trigger?: Record<string, unknown>;
}

export async function createMentalModel(
  payload: MentalModelCreate,
  opts: { bank?: "doctrine" | "character" | string; baseUrl?: string } = {},
): Promise<{ mental_model_id: string; operation_id: string }> {
  const bankId = pickBank({ bank: opts.bank });
  return call<{ mental_model_id: string; operation_id: string }>({
    baseUrl: opts.baseUrl,
    method: "POST",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}/mental-models`,
    body: payload,
    bankId,
  });
}

export type MentalModelDetail = "metadata" | "content" | "full";

export async function getMentalModel(
  mentalModelId: string,
  opts: { bank?: "doctrine" | "character" | string; detail?: MentalModelDetail; baseUrl?: string } = {},
): Promise<HindsightMentalModel> {
  const bankId = pickBank({ bank: opts.bank });
  const detail = opts.detail ?? "full";
  return call<HindsightMentalModel>({
    baseUrl: opts.baseUrl,
    method: "GET",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}/mental-models/${encodeURIComponent(
      mentalModelId,
    )}?detail=${detail}`,
    bankId,
  });
}

export async function listMentalModels(
  opts: { bank?: "doctrine" | "character" | string; baseUrl?: string } = {},
): Promise<Array<{ id: string; name: string; tags?: string[]; last_refreshed_at?: string | null; is_stale?: boolean | null }>> {
  const bankId = pickBank({ bank: opts.bank });
  return call<Array<{ id: string; name: string; tags?: string[]; last_refreshed_at?: string | null; is_stale?: boolean | null }>>({
    baseUrl: opts.baseUrl,
    method: "GET",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}/mental-models`,
    bankId,
  });
}

export interface MentalModelUpdate {
  name?: string;
  source_query?: string;
  max_tokens?: number;
  tags?: string[];
  trigger?: Record<string, unknown>;
}

export async function updateMentalModel(
  mentalModelId: string,
  payload: MentalModelUpdate,
  opts: { bank?: "doctrine" | "character" | string; baseUrl?: string } = {},
): Promise<HindsightMentalModel> {
  const bankId = pickBank({ bank: opts.bank });
  return call<HindsightMentalModel>({
    baseUrl: opts.baseUrl,
    method: "PATCH",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}/mental-models/${encodeURIComponent(
      mentalModelId,
    )}`,
    body: payload,
    bankId,
  });
}

export async function refreshMentalModel(
  mentalModelId: string,
  opts: { bank?: "doctrine" | "character" | string; baseUrl?: string } = {},
): Promise<HindsightOperation> {
  const bankId = pickBank({ bank: opts.bank });
  return call<HindsightOperation>({
    baseUrl: opts.baseUrl,
    method: "POST",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}/mental-models/${encodeURIComponent(
      mentalModelId,
    )}/refresh`,
    bankId,
  });
}

// ─── Operation status polling ─────────────────────────────────────────────

export async function getOperation(
  operationId: string,
  opts: { bank?: "doctrine" | "character" | string; baseUrl?: string } = {},
): Promise<HindsightOperation> {
  const bankId = pickBank({ bank: opts.bank });
  return call<HindsightOperation>({
    baseUrl: opts.baseUrl,
    method: "GET",
    path: `/v1/default/banks/${encodeURIComponent(bankId)}/operations/${encodeURIComponent(
      operationId,
    )}`,
    bankId,
  });
}

/** Poll until the operation reaches a terminal status, or max attempts. */
export async function awaitOperation(
  operationId: string,
  opts: { bank?: "doctrine" | "character" | string; pollMs?: number; maxAttempts?: number; baseUrl?: string } = {},
): Promise<HindsightOperation> {
  const pollMs = opts.pollMs ?? 1500;
  const maxAttempts = opts.maxAttempts ?? 20;
  for (let i = 0; i < maxAttempts; i++) {
    const op = await getOperation(operationId, { bank: opts.bank, baseUrl: opts.baseUrl });
    if (op.status === "completed" || op.status === "failed" || op.status === "cancelled") {
      return op;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new TachikomaMemoryError(
    `Operation ${operationId} did not reach terminal status after ${maxAttempts} attempts`,
    "hindsight",
  );
}

// ─── Health ──────────────────────────────────────────────────────────────

export async function health(
  baseUrl?: string,
): Promise<{ status: string; [k: string]: unknown }> {
  return call({
    baseUrl,
    method: "GET",
    path: "/health",
    bankId: "_health", // not used for this path; required by signature
  });
}

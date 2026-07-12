/**
 * LLM-tracing adapters — normalize each LLM-observability tool's API into one
 * `LlmPinpoint` row for the Dev Tools "LLM Overview" table.
 *
 * Mirrors `sub_overview/adapters.ts`: every call goes through the credential API
 * proxy (`executeApiRequest`), which resolves the base URL and injects the
 * connector's auth server-side (Bearer / Basic / x-api-key per the connector
 * strategy) — the frontend never sees the secret.
 *
 * All four tools are wired: LightTrack (live-verified) plus Langfuse / LangSmith
 * / Helicone. LightTrack rolls up server-side; the SaaS three return raw per-call
 * records that `foldByUseCase` aggregates. The SaaS response mappers are derived
 * from each tool's public API docs (not yet exercised against a live account) —
 * field names / paths may need small tuning on first real connection. Each mapper
 * is defensive and each fetch surfaces a clear error state.
 */
import { executeApiRequest } from '@/api/system/apiProxy';

// ---------------------------------------------------------------------------
// Normalized row + window types
// ---------------------------------------------------------------------------

/** A use-case rollup row — one logical LLM call-site, aggregated over the window. */
export interface LlmPinpoint {
  /** Use-case / call-site name; `null` when the call has none (rolls up by model). */
  useCaseName: string | null;
  /** Provider slug, e.g. "anthropic" | "openai" | "google". */
  provider: string;
  /** Model id, e.g. "claude-sonnet-4-5". */
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  /** True when the cost is a token×price estimate, not a billed amount. */
  costIsEstimate: boolean;
}

/** Connector service types that expose an LLM-tracing surface we can adapt. */
export type LlmToolServiceType = 'tracklight' | 'langfuse' | 'langsmith' | 'helicone';

/** Rolling window options for the overview. */
export type LlmWindow = '24h' | '7d' | '30d';

/** RFC3339 lower bound for a window, relative to `nowMs`. */
export function windowSince(window: LlmWindow, nowMs: number): string {
  const day = 86_400_000;
  const ms = window === '24h' ? day : window === '7d' ? 7 * day : 30 * day;
  return new Date(nowMs - ms).toISOString();
}

// ---------------------------------------------------------------------------
// Tracklight / LightTrack (self-hosted; github.com/xkazm04/tracklight)
// ---------------------------------------------------------------------------

interface TracklightUsecaseRow {
  name: string | null;
  provider: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/**
 * LightTrack: `GET /v1/usecases?since=` returns rows already grouped server-side
 * by (name, provider, model) over the window. We normalize them 1:1; the shared
 * `foldByUseCase` then collapses per-use-case to a default model.
 */
export async function fetchTracklightPinpoints(
  credentialId: string,
  since: string,
): Promise<LlmPinpoint[]> {
  const path = `/v1/usecases?since=${encodeURIComponent(since)}`;
  const res = await executeApiRequest(credentialId, 'GET', path, {});
  if (res.status >= 400) {
    throw new Error(
      `LightTrack /v1/usecases failed (${res.status}): ${res.body.slice(0, 200)}`,
    );
  }
  const rows = JSON.parse(res.body) as unknown;
  if (!Array.isArray(rows)) return [];
  return (rows as TracklightUsecaseRow[]).map((r): LlmPinpoint => ({
    useCaseName: r.name ?? null,
    provider: r.provider,
    model: r.model,
    calls: r.calls ?? 0,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    totalCostUsd: r.cost_usd ?? 0,
    // LightTrack prices each call from its token×price book — an estimate.
    costIsEstimate: true,
  }));
}

// ---------------------------------------------------------------------------
// Shared normalization helpers (used by the raw-record adapters below)
// ---------------------------------------------------------------------------

/**
 * Page size for the SaaS raw-record adapters. Unlike LightTrack (server-side
 * rollup), these return raw per-call records — kept modest so each response
 * stays under the proxy's 2 MB body cap (LangSmith/Helicone rows can be large).
 */
const PAGE_SIZE = 200;

/**
 * Hard cap on pages per fetch → up to PAGE_SIZE × MAX_PAGES records. Bounds
 * latency and API calls for very high-volume projects.
 */
const MAX_PAGES = 5;

/**
 * Fetch up to MAX_PAGES pages of raw pinpoints and concatenate them. `fetchPage`
 * returns this page's items plus the cursor for the NEXT page (a page number,
 * offset, or opaque token) — or `null` when there's no next page. The loop stops
 * on a `null` next, an empty page, or the page cap, so if a tool's next-page
 * signal can't be determined it safely degrades to a single page.
 */
export async function fetchPaged<C>(
  fetchPage: (cursor: C | null) => Promise<{ items: LlmPinpoint[]; next: C | null }>,
): Promise<LlmPinpoint[]> {
  const all: LlmPinpoint[] = [];
  let cursor: C | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, next } = await fetchPage(cursor);
    all.push(...items);
    if (items.length === 0 || next == null) break;
    cursor = next;
  }
  return all;
}

/** Coerce a number | numeric-string | anything into a finite number (else 0). */
function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * Whether an ISO timestamp is strictly before `since`. Missing/unparseable
 * timestamps are KEPT (never dropped) so a mapping gap can't silently hide data.
 * A client-side safety net so the window holds even when a tool's server-side
 * time filter is unavailable or shaped differently than expected.
 */
function olderThan(ts: string | null | undefined, since: string): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  return !Number.isNaN(t) && t < Date.parse(since);
}

/**
 * Best-effort provider slug from a model id — for tools that don't report the
 * provider (Langfuse) or leave it unset (LangSmith outside the LangChain SDK).
 */
export function inferProvider(model: string | null | undefined): string {
  const m = (model ?? '').toLowerCase();
  if (!m) return 'unknown';
  if (m.includes('claude') || m.startsWith('anthropic')) return 'anthropic';
  if (
    m.startsWith('gpt') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.includes('davinci') ||
    m.startsWith('text-embedding') ||
    m.startsWith('openai')
  )
    return 'openai';
  if (m.includes('gemini') || m.includes('palm') || m.startsWith('google') || m.startsWith('models/'))
    return 'google';
  if (m.includes('mixtral') || m.includes('mistral')) return 'mistral';
  if (m.includes('llama')) return 'meta';
  if (m.includes('command') || m.includes('cohere')) return 'cohere';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('grok')) return 'xai';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Langfuse — GET /api/public/v2/observations (HTTP Basic; Phase-1 strategy)
// ---------------------------------------------------------------------------

interface LangfuseObservation {
  name?: string | null;
  providedModelName?: string | null;
  model?: string | null;
  inputUsage?: number | null;
  outputUsage?: number | null;
  inputCost?: number | null;
  outputCost?: number | null;
  totalCost?: number | null;
  startTime?: string | null;
}

/**
 * Map Langfuse `{data: [...]}` observations into raw pinpoints (one per
 * generation). Langfuse doesn't report a provider — it's inferred from the
 * model. Filters to observations at/after `since`.
 */
export function mapLangfuseObservations(body: unknown, since: string): LlmPinpoint[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: LlmPinpoint[] = [];
  for (const o of data as LangfuseObservation[]) {
    if (olderThan(o.startTime, since)) continue;
    const model = o.providedModelName ?? o.model ?? 'unknown';
    const cost = o.totalCost ?? toNum(o.inputCost) + toNum(o.outputCost);
    out.push({
      useCaseName: o.name ?? null,
      provider: inferProvider(model),
      model,
      calls: 1,
      inputTokens: toNum(o.inputUsage),
      outputTokens: toNum(o.outputUsage),
      totalCostUsd: toNum(cost),
      costIsEstimate: true,
    });
  }
  return out;
}

export async function fetchLangfusePinpoints(
  credentialId: string,
  since: string,
): Promise<LlmPinpoint[]> {
  // Page-based (`page`); `fromStartTime` scopes every page to the window, and we
  // advance while `meta.totalPages` reports more.
  return fetchPaged<number>(async (page) => {
    const p = page ?? 1;
    const path = `/api/public/v2/observations?type=GENERATION&fromStartTime=${encodeURIComponent(
      since,
    )}&limit=${PAGE_SIZE}&page=${p}`;
    const res = await executeApiRequest(credentialId, 'GET', path, {});
    if (res.status >= 400) {
      throw new Error(`Langfuse observations failed (${res.status}): ${res.body.slice(0, 200)}`);
    }
    const parsed = JSON.parse(res.body);
    const items = mapLangfuseObservations(parsed, since);
    const totalPages = toNum(
      (parsed as { meta?: { totalPages?: unknown } } | null)?.meta?.totalPages,
    );
    return { items, next: totalPages > p ? p + 1 : null };
  });
}

// ---------------------------------------------------------------------------
// LangSmith — POST /runs/query (x-api-key; Phase-1 strategy)
// ---------------------------------------------------------------------------

interface LangSmithRun {
  name?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_cost?: number | string | null;
  prompt_cost?: number | string | null;
  completion_cost?: number | string | null;
  start_time?: string | null;
  extra?: { metadata?: { ls_model_name?: string | null; ls_provider?: string | null } | null } | null;
}

/**
 * Map LangSmith `{runs: [...]}` into raw pinpoints (one per llm run). Model +
 * provider come from `extra.metadata.ls_model_name` / `ls_provider` when the
 * tracer set them, else the model is `unknown` and the provider is inferred.
 */
export function mapLangSmithRuns(body: unknown, since: string): LlmPinpoint[] {
  const runs = (body as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(runs)) return [];
  const out: LlmPinpoint[] = [];
  for (const r of runs as LangSmithRun[]) {
    if (olderThan(r.start_time, since)) continue;
    const meta = r.extra?.metadata ?? {};
    const model = meta.ls_model_name ?? 'unknown';
    const provider = meta.ls_provider ? meta.ls_provider.toLowerCase() : inferProvider(model);
    const cost = toNum(r.total_cost) || toNum(r.prompt_cost) + toNum(r.completion_cost);
    out.push({
      useCaseName: r.name ?? null,
      provider,
      model,
      calls: 1,
      inputTokens: toNum(r.prompt_tokens),
      outputTokens: toNum(r.completion_tokens),
      totalCostUsd: toNum(cost),
      costIsEstimate: true,
    });
  }
  return out;
}

export async function fetchLangSmithPinpoints(
  credentialId: string,
  since: string,
): Promise<LlmPinpoint[]> {
  // Root path matches the connector's healthcheck (`/sessions`). Some LangSmith
  // deployments serve these under `/api/v1/...` — adjust here if a real workspace
  // 404s (see the doc-derived caveat in the module header). Cursor-paginated via
  // `cursors.next`.
  return fetchPaged<string>(async (cursor) => {
    const body = JSON.stringify({
      run_type: 'llm',
      start_time: since,
      limit: PAGE_SIZE,
      // Project only the fields we roll up — full runs carry inputs/outputs that
      // would blow the proxy's 2 MB body cap. Unknown-field selects are ignored
      // by the API, so this is safe even if the projection isn't honored.
      select: [
        'name',
        'run_type',
        'prompt_tokens',
        'completion_tokens',
        'total_cost',
        'prompt_cost',
        'completion_cost',
        'start_time',
        'extra',
      ],
      ...(cursor ? { cursor } : {}),
    });
    const res = await executeApiRequest(
      credentialId,
      'POST',
      '/runs/query',
      { 'Content-Type': 'application/json' },
      body,
    );
    if (res.status >= 400) {
      throw new Error(`LangSmith runs query failed (${res.status}): ${res.body.slice(0, 200)}`);
    }
    const parsed = JSON.parse(res.body);
    const next = (parsed as { cursors?: { next?: unknown } } | null)?.cursors?.next;
    return {
      items: mapLangSmithRuns(parsed, since),
      next: typeof next === 'string' && next ? next : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Helicone — POST /v1/request/query (Bearer)
// ---------------------------------------------------------------------------

interface HeliconeRequest {
  request_path?: string | null;
  request_model?: string | null;
  response_model?: string | null;
  provider?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  costUSD?: number | null;
  request_created_at?: string | null;
}

/**
 * Map Helicone request rows (`{data: [...]}` or a bare array) into raw
 * pinpoints (one per request). Helicone reports the provider directly. The
 * use-case name is `request_path` — the closest call-site label it exposes.
 * The window is applied client-side (Helicone's raw query isn't time-scoped here).
 */
export function mapHeliconeRequests(body: unknown, since: string): LlmPinpoint[] {
  const raw = body as { data?: unknown } | unknown[] | null;
  const data = Array.isArray(raw) ? raw : (raw as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: LlmPinpoint[] = [];
  for (const r of data as HeliconeRequest[]) {
    if (olderThan(r.request_created_at, since)) continue;
    const model = r.request_model ?? r.response_model ?? 'unknown';
    out.push({
      useCaseName: r.request_path ?? null,
      provider: r.provider ? r.provider.toLowerCase() : inferProvider(model),
      model,
      calls: 1,
      inputTokens: toNum(r.prompt_tokens),
      outputTokens: toNum(r.completion_tokens),
      totalCostUsd: toNum(r.costUSD),
      costIsEstimate: true,
    });
  }
  return out;
}

export async function fetchHeliconePinpoints(
  credentialId: string,
  since: string,
): Promise<LlmPinpoint[]> {
  // Offset-paginated, newest-first. Helicone's raw query isn't time-scoped here,
  // so we page until a page yields no in-window rows (all older than `since`) or
  // the page is short.
  return fetchPaged<number>(async (offset) => {
    const off = offset ?? 0;
    const body = JSON.stringify({
      filter: 'all',
      limit: PAGE_SIZE,
      offset: off,
      sort: { created_at: 'desc' },
    });
    const res = await executeApiRequest(
      credentialId,
      'POST',
      '/v1/request/query',
      { 'Content-Type': 'application/json' },
      body,
    );
    if (res.status >= 400) {
      throw new Error(`Helicone request query failed (${res.status}): ${res.body.slice(0, 200)}`);
    }
    const parsed = JSON.parse(res.body);
    const raw = Array.isArray(parsed) ? parsed : (parsed as { data?: unknown[] } | null)?.data;
    const pageLen = Array.isArray(raw) ? raw.length : 0;
    const items = mapHeliconeRequests(parsed, since);
    return { items, next: pageLen >= PAGE_SIZE && items.length > 0 ? off + PAGE_SIZE : null };
  });
}

// ---------------------------------------------------------------------------
// Shared rollup + dispatch
// ---------------------------------------------------------------------------

/**
 * Fold raw (name, provider, model) rows into one pinpoint per use-case: a named
 * use-case collapses across models to a single row showing its DEFAULT (most-
 * called) provider+model with summed usage; un-named calls stay keyed by model
 * (rendered as "unnamed"). Matches the chosen "use case name, default provider
 * and model" rollup. Sorted most-expensive first.
 */
export function foldByUseCase(rows: LlmPinpoint[]): LlmPinpoint[] {
  const groups = new Map<string, LlmPinpoint[]>();
  for (const r of rows) {
    // Un-named rows key by model so each model is its own "unnamed" row; named
    // rows key by name so they collapse across models. The distinct `name:` /
    // `model:` prefixes keep a literal use-case named "model:x" from colliding
    // with the un-named fallback bucket.
    const key = r.useCaseName != null ? `name:${r.useCaseName}` : `model:${r.model}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: LlmPinpoint[] = [];
  for (const g of groups.values()) {
    const primary = g.reduce((a, b) => (b.calls > a.calls ? b : a));
    out.push({
      useCaseName: primary.useCaseName,
      provider: primary.provider,
      model: primary.model,
      calls: g.reduce((s, r) => s + r.calls, 0),
      inputTokens: g.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: g.reduce((s, r) => s + r.outputTokens, 0),
      totalCostUsd: g.reduce((s, r) => s + r.totalCostUsd, 0),
      costIsEstimate: g.some((r) => r.costIsEstimate),
    });
  }
  return out.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

/**
 * Fetch + normalize + fold LLM pinpoints for a connector credential over a
 * rolling window. The single entry point the overview hook calls; dispatches to
 * the per-tool adapter by connector service type.
 */
export async function fetchLlmPinpoints(
  serviceType: string,
  credentialId: string,
  window: LlmWindow,
): Promise<LlmPinpoint[]> {
  const since = windowSince(window, Date.now());
  let raw: LlmPinpoint[];
  switch (serviceType) {
    case 'tracklight':
      raw = await fetchTracklightPinpoints(credentialId, since);
      break;
    case 'langfuse':
      raw = await fetchLangfusePinpoints(credentialId, since);
      break;
    case 'langsmith':
      raw = await fetchLangSmithPinpoints(credentialId, since);
      break;
    case 'helicone':
      raw = await fetchHeliconePinpoints(credentialId, since);
      break;
    default:
      throw new Error(
        `LLM Overview: live data for "${serviceType}" isn't wired up yet.`,
      );
  }
  return foldByUseCase(raw);
}

/** Connector service types with a working live-data adapter. */
const LIVE_ADAPTERS: ReadonlySet<string> = new Set<LlmToolServiceType>([
  'tracklight',
  'langfuse',
  'langsmith',
  'helicone',
]);

/** Whether a connector service type has a working live-data adapter today. */
export function hasLiveAdapter(serviceType: string): boolean {
  return LIVE_ADAPTERS.has(serviceType);
}

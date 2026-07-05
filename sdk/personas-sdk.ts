/**
 * Personas SDK — a zero-dependency TypeScript client for the local Personas
 * management API (`127.0.0.1:9420`). Works in the browser (for a paired cloud
 * app) and in Node.
 *
 * Quick start (browser cloud app):
 *
 *   import { pair, PersonasClient } from "./personas-sdk";
 *   const token = await pair({ scopes: ["personas:read"], name: "My Dashboard" });
 *   const client = new PersonasClient({ token });
 *   const { data } = await client.listPersonas();
 *
 * The management API is loopback-only and (for browsers) requires the user to
 * PAIR your origin once — `pair()` drives that flow. See the OpenAPI contract at
 * docs/api/management-api.openapi.yaml.
 *
 * NOTE: this is a single-file reference SDK. Promotion to a published npm package
 * (`@personas/sdk`) is a tracked follow-up; copy this file until then.
 */

export interface ApiResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export class PersonasError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "PersonasError";
  }
}

export interface PersonasClientOptions {
  /** Defaults to http://127.0.0.1:9420. */
  baseUrl?: string;
  /** A `pk_...` key (from the app's Settings → API Keys, or from `pair()`). */
  token: string;
  /**
   * Origin to send. Browsers set `Origin` automatically (and forbid overriding
   * it), so leave this unset there. In Node, set it to the origin the paired key
   * is bound to.
   */
  origin?: string;
  /** Override the fetch implementation (Node < 18, tests). */
  fetch?: typeof fetch;
}

const TERMINAL = new Set(["completed", "failed", "incomplete", "cancelled"]);

export class PersonasClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly origin?: string;
  private readonly _fetch: typeof fetch;

  constructor(opts: PersonasClientOptions) {
    this.baseUrl = (opts.baseUrl ?? "http://127.0.0.1:9420").replace(/\/$/, "");
    this.token = opts.token;
    this.origin = opts.origin;
    this._fetch = opts.fetch ?? fetch;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.origin) headers["Origin"] = this.origin; // Node only; browsers ignore.
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const retry = res.headers.get("Retry-After");
      throw new PersonasError(429, `rate limited; retry after ${retry ?? "?"}s`);
    }
    if (!res.ok) throw new PersonasError(res.status, `${method} ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  /** List personas (any valid key). */
  listPersonas(): Promise<ApiResult> {
    return this.req("GET", "/api/personas");
  }

  getPersona(personaId: string): Promise<ApiResult> {
    return this.req("GET", `/api/personas/${encodeURIComponent(personaId)}`);
  }

  /**
   * Start a non-blocking execution; returns its id. Requires
   * `personas:execute` or `personas:execute:persona:<id>`.
   */
  async execute(personaId: string, input?: unknown): Promise<string> {
    const r = await this.req<{ data: { execution_id: string } }>(
      "POST",
      `/api/execute/${encodeURIComponent(personaId)}`,
      { input_data: input ?? null },
    );
    return r.data.execution_id;
  }

  getExecution(executionId: string): Promise<ApiResult<{ status?: string }>> {
    return this.req("GET", `/api/executions/${encodeURIComponent(executionId)}`);
  }

  /** Poll an execution until it reaches a terminal status (or times out). */
  async waitForExecution(
    executionId: string,
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<ApiResult<{ status?: string }>> {
    const interval = opts.intervalMs ?? 1500;
    const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
    for (;;) {
      const r = await this.getExecution(executionId);
      const status = r.data?.status;
      if (status && TERMINAL.has(status)) return r;
      if (Date.now() > deadline) {
        throw new PersonasError(0, `execution ${executionId} did not finish in time`);
      }
      await sleep(interval);
    }
  }

  /** Execute and wait for the terminal result in one call. */
  async run(
    personaId: string,
    input?: unknown,
    wait?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<ApiResult<{ status?: string }>> {
    const id = await this.execute(personaId, input);
    return this.waitForExecution(id, wait);
  }
}

export interface PairOptions {
  baseUrl?: string;
  /** Requested scopes; the user can narrow these at approval time. */
  scopes?: string[];
  /** Human label shown in the approval modal. */
  name?: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Use the `personas://pair` deep link instead of `POST /pair/request`. */
  useDeepLink?: boolean;
}

/**
 * Pair this app with the user's local Personas. Sends a pairing request (raising
 * an in-app approval modal), then polls until the user approves and returns the
 * minted, origin-bound, single-use-claimed key. Throws on reject/timeout.
 */
export async function pair(opts: PairOptions = {}): Promise<string> {
  const baseUrl = (opts.baseUrl ?? "http://127.0.0.1:9420").replace(/\/$/, "");
  const f = opts.fetch ?? fetch;
  const nonce = randomNonce();

  if (opts.useDeepLink && typeof window !== "undefined") {
    const q = new URLSearchParams({
      origin: window.location.origin,
      nonce,
      name: opts.name ?? window.location.host,
      scopes: (opts.scopes ?? []).join(","),
    });
    window.location.href = `personas://pair?${q.toString()}`;
  } else {
    await f(`${baseUrl}/pair/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, scopes: opts.scopes ?? [], name: opts.name }),
    });
  }

  const interval = opts.pollIntervalMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  for (;;) {
    const res = await f(`${baseUrl}/pair/claim?nonce=${encodeURIComponent(nonce)}`);
    if (res.status === 200) return ((await res.json()) as { token: string }).token;
    if (res.status === 403) throw new PersonasError(403, "pairing rejected or origin mismatch");
    if (res.status === 410) throw new PersonasError(410, "pairing already claimed");
    if (Date.now() > deadline) throw new PersonasError(0, "pairing timed out (no approval)");
    await sleep(interval);
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

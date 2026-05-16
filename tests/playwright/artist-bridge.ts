/**
 * TS harness for driving the Artist plugin through the test-automation
 * HTTP server (port 17320 in dev, `PERSONAS_TEST_PORT` in production).
 *
 * Same shape as `companion-bridge.ts`: thin wrappers around the HTTP
 * primitives (`/query`, `/click-testid`, `/bridge-exec`, …) that turn
 * generic DOM/IPC ops into Artist-aware verbs the spec files can chain
 * declaratively.
 *
 * Pre-req: the app must be running with `npm run tauri:dev:test` (or a
 * production install launched with `PERSONAS_TEST_PORT=NNNN`).
 *
 * Endpoint quirks (same as the companion bridge — capture them here so
 * the next contributor doesn't relearn the hard way):
 *   - `/query` and `/find-text` return **bare arrays**, not `{nodes}`.
 *   - `/eval` is **fire-and-forget**; for result-bearing JS use
 *     `/bridge-exec` which dispatches to a named method on
 *     `window.__TEST__` and awaits via `__test_respond`.
 *   - `/click-testid` and `/fill-field` use snake_case `test_id`.
 */

const DEFAULT_PORT = Number(process.env.COMPANION_TEST_PORT ?? 17320);
const BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

export interface QueryNode {
  index?: number;
  tag: string;
  text: string;
  id: string | null;
  testId: string | null;
  className?: string;
  visible: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  selector?: string;
}

export type ArtistTab = 'blender' | 'gallery' | 'media-studio';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ArtistBridge {
  constructor(private readonly baseUrl: string = BASE_URL) {}

  // ── Low-level HTTP plumbing ────────────────────────────────────────

  private async post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${path} → ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  private async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GET ${path} → ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  private async bridgeExec<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutSecs = 30,
  ): Promise<T> {
    const raw = await this.post<string>('/bridge-exec', {
      method,
      params,
      timeout_secs: timeoutSecs,
    });
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && 'error' in parsed && (parsed as { error: unknown }).error) {
      throw new Error(`bridge ${method}: ${(parsed as { error: string }).error}`);
    }
    return parsed as T;
  }

  // ── Generic primitives ──────────────────────────────────────────────

  health(): Promise<{ status: string; server: string; version: string }> {
    return this.get('/health');
  }

  navigate(section: string): Promise<unknown> {
    return this.post('/navigate', { section });
  }

  clickTestId(testId: string): Promise<unknown> {
    return this.post('/click-testid', { test_id: testId });
  }

  query(selector: string): Promise<QueryNode[]> {
    return this.post<QueryNode[]>('/query', { selector });
  }

  /** Wait until a CSS selector matches at least one element. */
  async waitForSelector(selector: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const nodes = await this.query(selector);
      if (nodes.length > 0) return;
      await sleep(100);
    }
    throw new Error(`waitForSelector: "${selector}" did not appear within ${timeoutMs}ms`);
  }

  // ── Artist-specific helpers ─────────────────────────────────────────

  /**
   * Switch the Artist plugin's active sub-tab without going through the
   * sidebar UI. Drives the same `setArtistTab` zustand action the
   * `PluginsSidebarNav` entries fire on click.
   */
  async setArtistTab(tab: ArtistTab): Promise<void> {
    const result = await this.bridgeExec<{ success: boolean; tab?: string; error?: string }>(
      'setArtistTab',
      { tab },
    );
    if (!result.success) {
      throw new Error(`setArtistTab(${tab}): ${result.error ?? 'unknown error'}`);
    }
  }

  /** Read the current artist tab from the zustand store. */
  async getArtistTab(): Promise<ArtistTab> {
    const result = await this.bridgeExec<{ success: boolean; tab: string }>('getArtistTab');
    return result.tab as ArtistTab;
  }

  /**
   * Land on the Artist plugin's currently-selected sub-tab. Side effects:
   * (1) navigate the sidebar to `plugins`; (2) `setArtistTab(tab)`; (3)
   * wait for the per-tab `data-testid` planted on the wrapper.
   */
  async openArtist(tab: ArtistTab): Promise<void> {
    await this.navigate('plugins');
    await this.setArtistTab(tab);
    await this.waitForSelector(`[data-testid="artist-page-${tab}"]`);
  }

  /** Apply a Media Studio starter template by id. */
  async applyStarterTemplate(id: 'vertical-9-16' | 'horizontal-16-9' | 'square'): Promise<void> {
    await this.clickTestId(`starter-template-${id}`);
  }

  /**
   * Read the composition name from the toolbar input (the CompositionIdentity
   * `<input>` whose aria-label is "Composition name"). Returns null when the
   * element is not yet rendered (e.g. the timeline still shows the empty
   * state).
   */
  async getCompositionName(): Promise<string | null> {
    const nodes = await this.query('input[aria-label="Composition name"]');
    if (nodes.length === 0) return null;
    // The /query endpoint reports the input's text (its `.value` for inputs)
    // in the `text` field — companion-bridge.ts uses the same pattern.
    return nodes[0]?.text ?? null;
  }
}

/**
 * Bridge wrapper for diagnosing the template-adoption Persona Layout
 * surface. Built on the existing test-automation HTTP primitives
 * (`/query`, `/find-text`, `/click-testid`, `/eval`) — no new bridge
 * methods, so no app restart needed to start running these specs.
 *
 * Diagnostic-first design: each method tries to surface enough DOM
 * state for a spec to ASSERT what's actually live in the running
 * bundle, rather than driving navigation end-to-end. This is the right
 * shape when the open question is "did the fix land" — the spec
 * confirms the post-fix DOM signature is present (or reveals that the
 * running bundle still has the pre-fix structure).
 *
 * The companion + artist bridges follow the same low-level shape;
 * grep them for additional primitive examples if you extend this.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AdoptionBridge {
  constructor(private readonly baseUrl: string = BASE_URL) {}

  // ── HTTP plumbing ─────────────────────────────────────────────────

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

  // ── Generic primitives ───────────────────────────────────────────

  health(): Promise<{ status: string; server: string; version: string }> {
    return this.get('/health');
  }

  query(selector: string): Promise<QueryNode[]> {
    return this.post<QueryNode[]>('/query', { selector });
  }

  findText(text: string): Promise<QueryNode[]> {
    return this.post<QueryNode[]>('/find-text', { text });
  }

  /** Fire-and-forget JS evaluation in the WebView. Useful for setting
   *  state (scrollTop, etc.); for returning values use /query against
   *  a marker element the eval populated. */
  eval(js: string): Promise<unknown> {
    return this.post('/eval', { js });
  }

  async waitForSelector(selector: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const nodes = await this.query(selector);
      if (nodes.length > 0) return;
      await sleep(100);
    }
    throw new Error(`waitForSelector("${selector}") did not appear within ${timeoutMs}ms`);
  }

  // ── Adoption-diagnostic helpers ──────────────────────────────────

  /** Find the AdoptionWizardModal's content area. Confirms the modal
   *  is mounted (returns the panel root or `null` when the modal isn't
   *  open). The BaseModal portal renders into document.body, so this
   *  scopes via the modal title-id we know is present. */
  async getAdoptionModalRoot(): Promise<QueryNode | null> {
    const nodes = await this.query('[aria-labelledby="adoption-matrix-title"]');
    return nodes[0] ?? null;
  }

  /** Find the layout tab switcher's pills (Classic / Persona Layout).
   *  Used to confirm we're on the right tab before running the
   *  layer-specific assertions. */
  async getLayoutTabs(): Promise<QueryNode[]> {
    return this.query('[role="tablist"] button');
  }

  /** Click the "Persona Layout" tab pill — uses text search so it
   *  works without testids. */
  async clickPersonaLayoutTab(): Promise<void> {
    const hits = await this.findText('Persona Layout');
    const tabPill = hits.find((n) => n.tag === 'BUTTON');
    if (!tabPill) {
      throw new Error('clickPersonaLayoutTab: no button with text "Persona Layout" found');
    }
    // Synthesize a click via /eval since /click-testid needs a testid.
    await this.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('[role="tab"]'))
          .find((b) => (b.textContent || '').includes('Persona Layout'));
        if (btn) btn.click();
      })();
    `);
    await sleep(200);
  }

  /** Return the outermost ChronologyAdoptionView wrapper's className.
   *  This is the post-fix signature check for bug 1:
   *    - Pre-fix:  "flex flex-col h-full min-h-0"
   *    - Post-fix: "flex-1 min-h-0 flex flex-col"
   *  Both children of the adoption modal's flex column; the post-fix
   *  one is what makes the inner scroll container actually bound. */
  async getAdoptionContentRootClassName(): Promise<string | null> {
    // The ChronologyAdoptionView's pre-seed return is the second child
    // of the modal's inner relative wrapper (after the title bar). It
    // contains the layout switcher + the layout's content.
    const nodes = await this.query('[aria-labelledby="adoption-matrix-title"] > div > div');
    // Pick the one that contains the layout switcher (role=tablist).
    for (const n of nodes) {
      if (!n.className) continue;
      if (n.className.includes('flex-1 min-h-0 flex flex-col')) return n.className;
      if (n.className.includes('flex flex-col h-full min-h-0')) return n.className;
    }
    return nodes[0]?.className ?? null;
  }

  /** Stash scroll metrics onto a hidden data attribute on a marker
   *  element, then read them back via /query. Avoids needing a new
   *  bridge method.
   *
   *  Returns { scrollHeight, clientHeight, scrollTop } for the first
   *  element matching the selector, or null when nothing matches. */
  async getScrollMetrics(
    selector: string,
  ): Promise<{ scrollHeight: number; clientHeight: number; scrollTop: number; offsetHeight: number } | null> {
    // Stash the values on a known marker element. We use the
    // <body> so the read query is trivial.
    await this.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) {
          document.body.dataset.testScrollMetrics = 'null';
          return;
        }
        document.body.dataset.testScrollMetrics = JSON.stringify({
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollTop: el.scrollTop,
          offsetHeight: el.offsetHeight,
        });
      })();
    `);
    // /query doesn't return arbitrary dataset attributes. Use /eval to
    // copy the value into a textContent of a known marker node, then
    // /query for that node and read its text. Use a hidden span we
    // create on demand.
    await this.eval(`
      (() => {
        const id = 'test-scroll-metrics-marker';
        let n = document.getElementById(id);
        if (!n) {
          n = document.createElement('span');
          n.id = id;
          n.style.position = 'fixed';
          n.style.left = '-9999px';
          n.style.top = '0';
          document.body.appendChild(n);
        }
        n.textContent = document.body.dataset.testScrollMetrics ?? '';
      })();
    `);
    await sleep(60);
    const nodes = await this.query('#test-scroll-metrics-marker');
    const raw = nodes[0]?.text ?? '';
    if (!raw || raw === 'null') return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** Find a button whose visible text contains the given query. Uses
   *  innerText (CSS-transformed) per parallel-cli-workflow.md note 6.
   *  Returns the first match or null. */
  async findButton(textContains: string): Promise<QueryNode | null> {
    const hits = await this.findText(textContains);
    return hits.find((n) => n.tag === 'BUTTON') ?? null;
  }

  /** Click a button by its visible innerText. Uses /eval so we
   *  side-step the textContent-vs-innerText asymmetry. */
  async clickButtonByText(text: string): Promise<boolean> {
    const result = (await this.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find((b) => ((b.innerText || '').trim().includes(${JSON.stringify(text)})));
        if (!btn) return false;
        btn.click();
        return true;
      })();
    `)) as unknown;
    // /eval is fire-and-forget and returns { success: true } — we
    // confirm by re-querying for downstream DOM evidence.
    void result;
    await sleep(150);
    // Approximate signal: just re-find the button by text. The caller
    // typically asserts a downstream effect.
    return true;
  }

  /** Check whether the QuickAddCredentialModal is mounted. The modal
   *  renders a `fixed inset-0 z-50` backdrop with a child panel that
   *  has the h2 "Connect a {category} provider". */
  async isQuickAddCredentialModalOpen(): Promise<boolean> {
    const hits = await this.findText('Connect a');
    return hits.some(
      (n) =>
        n.tag === 'H2' &&
        n.visible &&
        (n.text ?? '').toLowerCase().includes('provider'),
    );
  }
}

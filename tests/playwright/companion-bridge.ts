/**
 * TS harness for the test-automation HTTP server (port 17320 in dev,
 * `PERSONAS_TEST_PORT` in production).
 *
 * Same architecture as `tools/test-mcp/server.py`: drive a *real*
 * running Tauri app via HTTP → JS bridge → DOM. No Chromium launch,
 * no WebDriver — Playwright is used here purely as a TS test runner.
 *
 * The bridge expects the app to already be running. Start it via:
 *   npm run tauri:dev:test
 * The Playwright tests connect to whichever port is exported via
 * `COMPANION_TEST_PORT` (defaults to 17320).
 *
 * **Endpoint quirks** (learned the hard way — capture them so the next
 * person doesn't):
 *   - `/query` and `/find-text` return **bare arrays**, not `{nodes}`.
 *   - `/eval` is **fire-and-forget** — no result return. For result-
 *     bearing JS, use `/bridge-exec` which dispatches to a named
 *     method on `window.__TEST__` and awaits via `__test_respond`.
 *   - `/click-testid` and `/fill-field` use snake_case `test_id`.
 */

const DEFAULT_PORT = Number(process.env.COMPANION_TEST_PORT ?? 17320);
const BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

/** A node returned by `/query` and `/find-text`. */
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

export interface CompanionMessage {
  role: 'user' | 'assistant' | 'system' | string;
  text: string;
}

export interface BrainCounts {
  episodes: number;
  reflections: number;
  facts: { user: number; project: number; world: number };
  procedurals: number;
  goals: number;
  rituals: number;
  backlog: number;
}

export interface CompanionPanelState {
  panelVisible: boolean;
  streaming: boolean;
  messages: CompanionMessage[];
  streamingText: string | null;
  approvals: number;
  brain: BrainCounts;
}

export interface TourStateSnapshot {
  active: boolean;
  tourId: string;
  currentStepIndex: number;
  completed: boolean;
  dismissed: boolean;
  stepIds: string[];
  stepCompleted: Array<{ id: string; done: boolean }>;
  allCompleted: boolean;
}

/**
 * Every tour id in `TOUR_REGISTRY` (src/stores/slices/system/tourSlice.ts).
 * Kept in sync by hand — if a tour is added/removed there, update this list
 * so `bootstrapFreshUser()` keeps resetting all of them.
 */
export const ALL_TOUR_IDS = [
  'getting-started',
  'getting-started-simple',
  'execution-observability',
  'orchestration-events',
  'plugins-explorer',
  'schedules-mastery',
  'templates-recipes',
] as const;

export class CompanionBridge {
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

  /**
   * Call a named method on the JS-side bridge (`window.__TEST__.<method>`)
   * and await its result. Use this for any operation that needs a
   * structured return value — `/eval` is fire-and-forget.
   */
  private async bridgeExec<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutSecs = 60,
  ): Promise<T> {
    const raw = await this.post<string>('/bridge-exec', {
      method,
      params,
      timeout_secs: timeoutSecs,
    });
    // The bridge wraps results as JSON-encoded strings via __test_respond.
    // The HTTP handler returns the raw payload string; parse here.
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

  fillField(testId: string, value: string): Promise<unknown> {
    return this.post('/fill-field', { test_id: testId, value });
  }

  query(selector: string): Promise<QueryNode[]> {
    return this.post<QueryNode[]>('/query', { selector });
  }

  findText(text: string): Promise<QueryNode[]> {
    return this.post<QueryNode[]>('/find-text', { text });
  }

  /** Wait for a CSS selector to appear (default 5s). Throws on timeout. */
  waitFor(selector: string, timeoutMs = 5_000): Promise<unknown> {
    return this.post('/wait', { selector, timeout_ms: timeoutMs });
  }

  // ── Companion-specific helpers ─────────────────────────────────────

  /**
   * Open the chat panel via the footer icon. Idempotent — returns once
   * `companionInspect` reports `panelVisible: true`.
   *
   * NOTE: we deliberately do NOT use `/wait` here — its visibility check
   * is `offsetParent !== null`, which is always null for `position: fixed`
   * elements like this panel. Polling `companionInspect` (which checks
   * existence in DOM via querySelector) is the reliable path.
   */
  async openChatPanel(timeoutMs = 5_000): Promise<void> {
    const initial = await this.snapshotPanel();
    if (initial.panelVisible) return;

    await this.clickTestId('footer-companion');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.snapshotPanel();
      if (state.panelVisible) return;
      await sleep(100);
    }
    throw new Error(`openChatPanel: panel did not appear within ${timeoutMs}ms`);
  }

  /**
   * Open the companion plugin sub-page (Setup / Memory / Voice tabs).
   * Polls `query` directly (cheaper than `/wait` and works even when
   * the target is `position: fixed`).
   */
  async openCompanionPlugin(timeoutMs = 5_000): Promise<void> {
    await this.navigate('plugins');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const nodes = await this.query('[data-testid="tab-companion"]');
      if (nodes.some((n) => n.visible)) {
        await this.clickTestId('tab-companion');
        return;
      }
      await sleep(150);
    }
    throw new Error('openCompanionPlugin: tab-companion not found');
  }

  /**
   * Reset the conversation by clicking the reset button. Backend wipes
   * SQL transcript + Claude session pointer. Returns once the message
   * list is empty in the DOM.
   */
  async resetConversation(timeoutMs = 8_000): Promise<void> {
    await this.openChatPanel();
    await this.clickTestId('companion-reset');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.snapshotPanel();
      // Require panel still open AND message list cleared. A panel that
      // closed mid-reset would otherwise pass via vacuous truth
      // (no panel → no messages).
      if (state.panelVisible && state.messages.length === 0 && !state.streaming) {
        return;
      }
      await sleep(200);
    }
    throw new Error('resetConversation: messages did not clear within timeout');
  }

  /**
   * Type a message into the composer and click send. Does NOT wait for
   * the assistant reply — pair with `waitForReply()` for the round-trip.
   */
  async sendMessageNoWait(text: string): Promise<void> {
    await this.openChatPanel();
    await this.fillField('companion-composer', text);
    await this.clickTestId('companion-send');
  }

  /**
   * Wait until the streaming bubble is gone AND the assistant message
   * count reaches `expectedAssistantCount`. Polls every 500ms.
   *
   * `timeoutMs` defaults to 4 minutes — Opus is slow; 1-3 minutes per
   * turn is normal. Don't lower this without a reason.
   */
  async waitForReply(
    expectedAssistantCount: number,
    timeoutMs = 240_000,
  ): Promise<CompanionMessage[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.snapshotPanel();
      const assistantCount = state.messages.filter((m) => m.role === 'assistant').length;
      if (assistantCount >= expectedAssistantCount && !state.streaming) {
        return state.messages;
      }
      await sleep(500);
    }
    throw new Error(
      `waitForReply: timed out after ${timeoutMs}ms (expected ${expectedAssistantCount} assistant messages)`,
    );
  }

  /** Send a message + wait for the reply, returning the assistant text. */
  async sendAndAwait(text: string, timeoutMs = 240_000): Promise<string> {
    const before = await this.snapshotPanel();
    const beforeAssistant = before.messages.filter((m) => m.role === 'assistant').length;
    await this.sendMessageNoWait(text);
    const messages = await this.waitForReply(beforeAssistant + 1, timeoutMs);
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last) {
      throw new Error('sendAndAwait: no assistant reply found in messages');
    }
    return last.text;
  }

  /**
   * Single round-trip snapshot of the panel state plus brain counts.
   * Backed by `window.__TEST__.companionInspect()` which reads the DOM
   * + invokes `companion_list_brain_items` for episode/fact/reflection
   * counts. ~50ms typical.
   */
  snapshotPanel(): Promise<CompanionPanelState> {
    return this.bridgeExec<CompanionPanelState>('companionInspect');
  }

  /**
   * Phase E: count of "Athena reached out" cards currently rendered in
   * the chat panel. 0 is the typical state — these only appear when
   * the proactive engine fires (real goals/backlog/rituals + clock).
   */
  async proactiveCardCount(): Promise<number> {
    const nodes = await this.query('[data-testid="companion-proactive-card"]');
    return nodes.filter((n) => n.visible).length;
  }

  /**
   * Phase F: read the className of the dev-tools plugin toggle. The
   * "enabled" CSS signature includes `bg-primary/25` + `ring-1`; the
   * "disabled" variant uses `text-foreground/55`. Tests assert on
   * className contains rather than full equality so future cosmetic
   * tweaks don't break them.
   */
  async devToolsButtonClass(): Promise<string | null> {
    const nodes = await this.query(
      '[data-testid="companion-plugin-dev-tools"]',
    );
    return nodes[0]?.className ?? null;
  }

  /**
   * Phase F: list of pinned-connector enabled states keyed by service
   * type. Reads `data-companion-connector-enabled` directly from the
   * sidebar buttons so the test matches what the user actually sees.
   */
  async pinnedConnectorStates(): Promise<Record<string, boolean>> {
    const nodes = await this.query(
      '[data-testid^="companion-connector-"]',
    );
    const out: Record<string, boolean> = {};
    for (const n of nodes) {
      if (!n.testId || !n.testId.startsWith('companion-connector-')) continue;
      // testid shape: companion-connector-<service_type>
      const name = n.testId.replace('companion-connector-', '');
      // Visibility = pinned. Enabled state would be on
      // `data-companion-connector-enabled` but `query` doesn't expose
      // arbitrary attributes. Fall back to className signature: the
      // enabled variant has `opacity-100`, disabled has `opacity-65`.
      out[name] = (n.className ?? '').includes('opacity-100');
    }
    return out;
  }

  /**
   * A2: read the persisted autonomous-mode toggle state from
   * systemStore. The chat-panel header reflects this — when `true`
   * the ∞ button renders in the active (primary-tinted) variant.
   */
  async getAutonomousMode(): Promise<boolean> {
    const r = await this.bridgeExec<{ enabled: boolean }>(
      'getCompanionAutonomousMode',
    );
    return r.enabled;
  }

  /**
   * A2: programmatically flip autonomous mode without going through
   * the click path (which is tested separately). Returns when the
   * setter has resolved.
   */
  async setAutonomousMode(enabled: boolean): Promise<void> {
    await this.bridgeExec('setCompanionAutonomousMode', { enabled });
  }

  /**
   * A5: force the panel into a streaming state. Lets Stop-button
   * presence and click behavior be verified without burning a real
   * Claude turn (which is also tested, but expensively, in
   * `athena-conversation.spec.ts`).
   */
  async forceStreaming(
    streaming: boolean,
    streamingText?: string,
    streamingPhase?: {
      kind: 'thinking' | 'tool_use' | 'reviewing';
      toolName?: string;
    } | null,
  ): Promise<void> {
    await this.bridgeExec('forceCompanionStreaming', {
      streaming,
      streamingText,
      streamingPhase,
    });
  }

  /**
   * Inject synthetic messages into the chat transcript. Store-only —
   * not persisted. Useful for verifying role-specific rendering
   * (system episodes, autonomous markers, long content) without
   * driving a real conversation.
   */
  async setMessages(
    messages: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system' | string;
      content: string;
      createdAt?: string;
    }>,
  ): Promise<void> {
    await this.bridgeExec('setCompanionMessages', { messages });
  }

  /**
   * Inject synthetic chat-cards. Wraps `bridge.setCompanionChatCards`
   * (added 2026-05-16 for the persona-design family). Drives the
   * `chatCards` store slice that backs `InlineChatCard` rendering;
   * bypasses a real dispatcher emit.
   */
  async setChatCards(
    cards: Array<{
      kind: string;
      title?: string | null;
      config?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    await this.bridgeExec('setCompanionChatCards', { cards });
  }

  /**
   * Generic Tauri-command passthrough. The frontend bridge owns auth
   * + serde shape; tests call this to drive backend commands the
   * frontend would normally trigger via UI action. Returns the
   * command's deserialized result, or throws on backend error.
   */
  async invokeCommand<T = unknown>(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const r = await this.bridgeExec<{
      success: boolean;
      result?: T;
      error?: string;
    }>('invokeCommand', { command, params });
    if (!r.success) {
      throw new Error(`invokeCommand(${command}) failed: ${r.error ?? 'unknown'}`);
    }
    return r.result as T;
  }

  // ── Fresh-user bootstrap ───────────────────────────────────────────

  /**
   * Evaluate fire-and-forget JS in the WebView (no return value). For
   * result-bearing calls use a named bridge method via `bridgeExec`.
   */
  async eval(js: string): Promise<void> {
    await this.post('/eval', { js });
  }

  /**
   * Put the app into the state a brand-new user would reach AFTER getting
   * past first-run — i.e. ready to drive the guided tours.
   *
   * On an empty isolated DB (see scripts/test/launch-isolated.mjs) the
   * first-run onboarding modal auto-opens, and `GuidedTour` renders nothing
   * while `onboardingActive` (it returns null so the modal owns the screen).
   * So before any tour can be walked we must dismiss that modal. We also
   * reset all seven tours so progress carried in WebView localStorage from a
   * prior session can't pre-complete steps.
   *
   * Idempotent and harmless against a normal running instance, so specs can
   * call it unconditionally in `beforeAll`.
   */
  async bootstrapFreshUser(): Promise<void> {
    // finishOnboarding(): onboardingActive=false, onboardingCompleted=true —
    // see src/stores/slices/system/onboardingSlice.ts. There is no dedicated
    // bridge method for it, so reach the store via the global exposed in
    // src/test/automation/bridge.ts (`window.__SYSTEM_STORE__`).
    await this.eval('window.__SYSTEM_STORE__ && window.__SYSTEM_STORE__.getState().finishOnboarding()');
    // Give the eval a beat to apply before the tour resets read state.
    await sleep(300);
    for (const id of ALL_TOUR_IDS) {
      await this.tourReset(id);
    }
  }

  // ── Guided-tour helpers ────────────────────────────────────────────

  /** Start (or resume) a guided tour. Omit `tourId` to use the active one. */
  tourStart(tourId?: string): Promise<{ success: boolean }> {
    return this.bridgeExec('tourStart', tourId ? { tourId } : {});
  }

  /** Reset a tour's persisted progress so a spec starts from a clean slate. */
  tourReset(tourId?: string): Promise<{ success: boolean }> {
    return this.bridgeExec('tourReset', tourId ? { tourId } : {});
  }

  /** Fire a tour completion event directly (advances the current step if it matches). */
  tourEmit(eventKey: string): Promise<{ success: boolean }> {
    return this.bridgeExec('tourEmit', { eventKey });
  }

  /** Snapshot the guided-tour state for assertions. */
  tourState(): Promise<TourStateSnapshot> {
    return this.bridgeExec<TourStateSnapshot>('tourState');
  }

  // ── Persona build helpers (real build → promote) ───────────────────

  /** Fill the intent field + launch a real build session. */
  startBuildFromIntent(
    intent: string,
    timeoutMs = 60_000,
  ): Promise<{ success: boolean; sessionId?: string; personaId?: string | null; phase?: string; error?: string }> {
    return this.bridgeExec('startBuildFromIntent', { intent, timeoutMs }, Math.ceil(timeoutMs / 1000) + 10);
  }

  /** Answer any currently-pending build questions (cellKey → free text). */
  answerPendingBuildQuestions(
    answers: Record<string, string>,
  ): Promise<{ success: boolean; answered?: string[]; pendingKeys?: string[]; error?: string }> {
    return this.bridgeExec('answerPendingBuildQuestions', { answers });
  }

  /** Wait until the build reaches one of `phases`. */
  waitForBuildPhase(
    phases: string[] | string,
    timeoutMs = 120_000,
  ): Promise<{ success: boolean; phase?: string; pendingCount?: number; error?: string }> {
    return this.bridgeExec('waitForBuildPhase', { phases, timeoutMs }, Math.ceil(timeoutMs / 1000) + 10);
  }

  /** List the build questions currently awaiting an answer. */
  listPendingBuildQuestions(): Promise<{ success: boolean; questions: unknown[] }> {
    return this.bridgeExec('listPendingBuildQuestions');
  }

  /** Promote the current draft to a live persona. Returns its id. */
  promoteBuildDraft(): Promise<{ success: boolean; personaId?: string; error?: string }> {
    return this.bridgeExec('promoteBuildDraft', {}, 120);
  }

  /** Whether the chat panel currently shows a `sendError` chip. */
  async hasSendErrorChip(): Promise<boolean> {
    // The error chip is rendered as a rose-tinted div near the bottom
    // of the transcript when `sendError` is set in the store. We
    // probe by text class signature rather than testid (the chip
    // doesn't have one yet).
    const nodes = await this.query('.text-rose-400');
    return nodes.some((n) => n.visible && /timed out|failed/i.test(n.text ?? ''));
  }
}

export function bridge(): CompanionBridge {
  return new CompanionBridge();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

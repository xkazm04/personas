/**
 * Test Automation Bridge
 *
 * Exposes deterministic test automation hooks on `window.__TEST__` that the
 * Rust test-automation HTTP server invokes via `WebviewWindow::eval()`.
 *
 * Loaded conditionally in dev mode — zero cost in production builds.
 */
import { invoke } from "@tauri-apps/api/core";
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useVaultStore } from "@/stores/vaultStore";
import { sections as sidebarSections } from "@/features/shared/components/layout/sidebar/sidebarData";
import { isTierVisible, TIERS, BUILD_MAX_TIER } from "@/lib/constants/uiModes";
import type { SidebarSection } from "@/lib/types/types";

const VALID_SECTIONS: SidebarSection[] = [
  "home", "overview", "personas", "events", "credentials",
  "design-reviews", "plugins", "settings",
];

/**
 * Render any thrown value into a useful string for the bridge response.
 * Tauri rejects with structured AppError objects, not Error instances —
 * `String({...})` would yield `"[object Object]"`, swallowing the real
 * cause. Probe the common shapes (`.message`, `.error`, nested
 * `{error,kind}`) before falling back to a JSON dump.
 */
function unpackError(e: unknown): string {
  if (e == null) return "Unknown error";
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const obj = e as Record<string, unknown>;
    const msg = obj.message ?? obj.error ?? obj.reason;
    if (typeof msg === "string" && msg.length > 0) return msg;
    if (msg && typeof msg === "object") {
      const inner = (msg as Record<string, unknown>).message ?? (msg as Record<string, unknown>).error;
      if (typeof inner === "string") return inner;
    }
    try { return JSON.stringify(e); } catch { /* circular — fall through */ }
  }
  return String(e);
}

interface TestBridge {
  navigate(section: string): { success: boolean; section?: string; error?: string };
  getState(): Record<string, unknown>;
  click(selector: string): { success: boolean; error?: string };
  typeText(selector: string, text: string): { success: boolean; error?: string };
  query(selector: string): Array<Record<string, unknown>>;
  findText(text: string): Array<Record<string, unknown>>;
  waitFor(selector: string, timeoutMs?: number): Promise<{ success: boolean; error?: string }>;
  listInteractive(): Array<Record<string, unknown>>;
  getAgentCards(): Array<Record<string, unknown>>;
  selectAgent(nameOrId: string): { success: boolean; id?: string; name?: string; error?: string };
  openEditorTab(tab: string): { success: boolean; tab?: string; error?: string };
  startCreateAgent(): { success: boolean };
  getSnapshot(): Record<string, unknown>;
  fillField(testId: string, value: string): { success: boolean; testId?: string; value?: string; error?: string };
  clickTestId(testId: string): { success: boolean; testId?: string; error?: string };
  waitForToast(text: string, timeoutMs?: number): Promise<{ success: boolean; text?: string; error?: string }>;
  searchAgents(query: string): { success: boolean; query?: string; error?: string };
  openSettingsTab(tab: string): { success: boolean; tab?: string };
  simulateBuild(phase: string, personaId: string, cells: Record<string, string>): { success: boolean; phase?: string; personaId?: string };
  answerBuildQuestion(cellKey: string, optionIndex: number): Promise<Record<string, unknown>>;
  deleteAgent(nameOrId: string): Promise<{ success: boolean; deleted?: string; error?: string }>;
  listCliCapturable(): Promise<{ success: boolean; services?: string[]; error?: string }>;
  cliCaptureRun(serviceType: string): Promise<{
    success: boolean;
    serviceType?: string;
    fieldKeys?: string[];
    fieldCount?: number;
    tokenTtlSeconds?: number | null;
    capturedAt?: string;
    expiresAt?: string | null;
    error?: string;
  }>;
  __reset__(): Promise<{ success: boolean; error?: string }>;
  __exec__(id: string, method: string, params: Record<string, unknown>): Promise<void>;
  // -- Build-from-scratch scenario helpers (see /bridge-exec dispatcher) --
  startBuildFromIntent(intent: string, timeoutMs?: number): Promise<{ success: boolean; sessionId?: string; personaId?: string | null; phase?: string; error?: string }>;
  answerPendingBuildQuestions(answers: Record<string, string>): Promise<{ success: boolean; answered?: string[]; pendingKeys?: string[]; error?: string }>;
  waitForBuildPhase(phases: string[] | string, timeoutMs?: number): Promise<{ success: boolean; phase?: string; pendingCount?: number; error?: string }>;
  listPendingBuildQuestions(): { success: boolean; questions: unknown[] };
  driveWriteText(relPath: string, content: string): Promise<{ success: boolean; entry?: unknown; error?: string }>;
  driveReadText(relPath: string): Promise<{ success: boolean; content?: string; error?: string }>;
  driveList(relPath?: string): Promise<{ success: boolean; count?: number; entries?: unknown[]; error?: string }>;
  waitForPersonaExecution(personaId: string, sinceIso: string, timeoutMs?: number): Promise<{ success: boolean; execution?: Record<string, unknown>; seen?: number; error?: string }>;
  [key: string]: unknown;
}

/** Turn an arbitrary caught value into a human-readable error string.
 *  Tauri IPC errors deserialize as plain objects that stringify to
 *  `[object Object]` — JSON.stringify is the only thing that surfaces the
 *  actual AppError variant (e.g. {Validation: "..."}). */
function _fmtBridgeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

/** Extract declared parameter names from a function's source. Returns an
 *  empty array when the source can't be parsed (minified builds, arrow
 *  functions with destructured params, `...rest` only, etc.). */
function parseParamNames(fn: (...a: unknown[]) => unknown): string[] {
  const src = Function.prototype.toString.call(fn);
  // Match the first parenthesised parameter list. Five shapes we care about:
  //   function name(a, b)                    ← classic named fn
  //   async function(a, b) { ... }           ← anonymous function expr
  //   async name(a, b) { ... }               ← method shorthand (what
  //                                            `bridge.driveWriteText(a, b)`
  //                                            stringifies to)
  //   (a, b) => ...                          ← arrow
  //   async (a, b) => ...                    ← async arrow
  // The prior regex required `function` when there was no leading `(`, so
  // method shorthand fell through → Object.values fallback → alphabetical
  // arg order bug that was the whole reason we added named dispatch.
  const match = src.match(
    /^(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$][A-Za-z0-9_$]*\s*)?\(([^)]*)\)/,
  ) ?? src.match(/^(?:async\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\(([^)]*)\)/);
  if (!match) return [];
  const raw = match[1] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    // Drop default-value expressions and `...rest`, then keep plain identifiers.
    .map((s) => (s.split('=')[0] ?? '').trim())
    .filter((s) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s));
}

/** Map a params object onto a function's positional args by declared name.
 *  Falls back to Object.values(params) when names can't be recovered (so
 *  single-arg methods still work via the original key-insensitive path). */
function resolveArgs(
  fn: (...a: unknown[]) => unknown,
  params: Record<string, unknown>,
): unknown[] {
  const names = parseParamNames(fn);
  const keys = Object.keys(params);
  // Only use named dispatch when at least one declared name matches a param
  // key. This keeps `__exec__("foo", {x: 1})` working for methods whose first
  // arg name doesn't appear in the params object (callers that pass raw
  // positional tuples via `{0: ..., 1: ...}` etc.).
  if (names.length > 0 && keys.some((k) => names.includes(k))) {
    return names.map((n) => params[n]);
  }
  return Object.values(params);
}

function generateSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === "string"
    ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
    : "";
  return `${tag}${cls}`;
}

const bridge: TestBridge = {
  async __reset__() {
    try {
      const eventBridge = await import("@/lib/eventBridge");
      await eventBridge.teardownAllListeners();
      await eventBridge.initAllListeners();
      useAgentStore.getState().resetBuildSession();
      useSystemStore.getState().setSidebarSection("personas");
      return { success: true };
    } catch (e) {
      return { success: false, error: unpackError(e) };
    }
  },

  navigate(section: string) {
    if (!VALID_SECTIONS.includes(section as SidebarSection)) {
      return { success: false, error: `Invalid section: ${section}. Valid: ${VALID_SECTIONS.join(", ")}` };
    }
    // Check tier gating: the Sidebar component will redirect inaccessible sections
    // back to home via useEffect — surface that early so callers get honest feedback.
    const def = sidebarSections.find((s) => s.id === section);
    if (def) {
      const minTier = def.minTier ?? TIERS.STARTER;
      if (!isTierVisible(minTier, BUILD_MAX_TIER)) {
        return { success: false, error: `Section "${section}" requires tier "${minTier}" (current: "${BUILD_MAX_TIER}")` };
      }
      if (def.devOnly && !import.meta.env.DEV) {
        return { success: false, error: `Section "${section}" is dev-only` };
      }
    }
    useSystemStore.getState().setSidebarSection(section as SidebarSection);
    return { success: true, section };
  },

  getState() {
    const sys = useSystemStore.getState();
    const agent = useAgentStore.getState();
    return {
      // Build state
      buildPhase: agent.buildPhase,
      buildPersonaId: agent.buildPersonaId,
      buildSessionId: agent.buildSessionId,
      buildError: agent.buildError,
      buildProgress: agent.buildProgress,
      buildCellStates: agent.buildCellStates,
      buildActivity: agent.buildActivity,
      buildOutputLineCount: agent.buildOutputLines.length,
      buildTestPassed: agent.buildTestPassed ?? null,
      buildTestError: agent.buildTestError ?? null,
      buildTestOutputLines: agent.buildTestOutputLines,
      // UI state
      sidebarSection: sys.sidebarSection,
      homeTab: sys.homeTab,
      editorTab: sys.editorTab,
      cloudTab: sys.cloudTab,
      settingsTab: sys.settingsTab,
      isLoading: sys.isLoading,
      error: sys.error,
      isCreatingPersona: sys.isCreatingPersona,
      selectedPersonaId: agent.selectedPersonaId,
      personaCount: agent.personas.length,
      personas: agent.personas.map(p => ({ id: p.id, name: p.name, enabled: p.enabled })),
    };
  },

  click(selector: string) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };
    if (!(el as HTMLElement).offsetParent && !el.closest("[data-radix-portal]")) {
      return { success: false, error: `Element not visible: ${selector}` };
    }
    (el as HTMLElement).click();
    return { success: true };
  },

  typeText(selector: string, text: string) {
    const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return { success: false, error: `Element not found: ${selector}` };
    // React-compatible value setting: bypass React's synthetic onChange
    const isTextArea = el instanceof HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true };
  },

  query(selector: string) {
    const elements = document.querySelectorAll(selector);
    return Array.from(elements).map((el, i) => {
      const rect = el.getBoundingClientRect();
      return {
        index: i,
        tag: el.tagName.toLowerCase(),
        text: (el as HTMLElement).innerText?.substring(0, 300) ?? "",
        id: el.id || null,
        testId: el.getAttribute("data-testid") || null,
        className: typeof el.className === "string" ? el.className.substring(0, 200) : null,
        visible: (el as HTMLElement).offsetParent !== null,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
  },

  findText(text: string) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const matches: Array<Record<string, unknown>> = [];
    const seen = new Set<Element>();
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes(text)) {
        const el = node.parentElement;
        if (el && !seen.has(el)) {
          seen.add(el);
          matches.push({
            tag: el.tagName.toLowerCase(),
            text: el.innerText?.substring(0, 300),
            selector: generateSelector(el),
            visible: el.offsetParent !== null,
          });
        }
      }
    }
    return matches;
  },

  async waitFor(selector: string, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el && (el as HTMLElement).offsetParent !== null) {
        return { success: true };
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return { success: false, error: `Timeout (${timeoutMs}ms) waiting for: ${selector}` };
  },

  listInteractive() {
    const selectors = "button, a[href], input, textarea, select, [role='button'], [role='tab'], [role='menuitem'], [data-testid]";
    const elements = document.querySelectorAll(selectors);
    return Array.from(elements)
      .filter(el => (el as HTMLElement).offsetParent !== null) // visible only
      .map((el, i) => {
        const rect = el.getBoundingClientRect();
        return {
          index: i,
          tag: el.tagName.toLowerCase(),
          type: (el as HTMLInputElement).type || null,
          text: (el as HTMLElement).innerText?.substring(0, 150)?.trim() || null,
          ariaLabel: el.getAttribute("aria-label") || null,
          testId: el.getAttribute("data-testid") || null,
          title: el.getAttribute("title") || null,
          placeholder: (el as HTMLInputElement).placeholder || null,
          selector: generateSelector(el),
          disabled: (el as HTMLButtonElement).disabled ?? false,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      });
  },

  // ── Workflow Macros (high-level compound operations) ──────────────────

  /** Get structured info about all visible agent cards */
  getAgentCards() {
    const cards = document.querySelectorAll("[data-testid^='overview-agent-'], [data-testid^='agent-card-']");
    return Array.from(cards).map(el => ({
      testId: el.getAttribute("data-testid"),
      name: (el as HTMLElement).innerText?.split("\n")[0]?.trim().substring(0, 100) ?? "",
      visible: (el as HTMLElement).offsetParent !== null,
    }));
  },

  /** Refresh the persona list from the database */
  async refreshPersonas() {
    await useAgentStore.getState().fetchPersonas();
    const count = useAgentStore.getState().personas.length;
    return { success: true, count };
  },

  /** Select an agent by name (exact match first, then partial) or ID */
  selectAgent(nameOrId: string) {
    const store = useAgentStore.getState();
    // Prefer exact ID match, then exact name match, then partial
    const match = store.personas.find(p => p.id === nameOrId)
      || store.personas.find(p => p.name === nameOrId)
      || store.personas.find(p => p.name.toLowerCase().includes(nameOrId.toLowerCase()));
    if (!match) return { success: false, error: `No agent matching: ${nameOrId}` };
    store.selectPersona(match.id);
    return { success: true, id: match.id, name: match.name };
  },

  /** Navigate to a specific editor tab for the currently selected agent */
  openEditorTab(tab: string) {
    const validTabs = ["activity", "matrix", "use-cases", "prompt", "lab", "connectors", "chat", "design", "health", "settings"];
    if (!validTabs.includes(tab)) {
      return { success: false, error: `Invalid tab: ${tab}. Valid: ${validTabs.join(", ")}` };
    }
    useSystemStore.getState().setEditorTab(tab as never);
    return { success: true, tab };
  },

  /** Start the agent creation flow with an intent description */
  startCreateAgent() {
    useAgentStore.getState().selectPersona(null);
    useSystemStore.getState().setIsCreatingPersona(true);
    useSystemStore.getState().setSidebarSection("personas");
    return { success: true };
  },

  /** Get a semantic snapshot of the current view */
  getSnapshot() {
    const sys = useSystemStore.getState();
    const agent = useAgentStore.getState();

    // Visible modals/dialogs
    const modals = Array.from(document.querySelectorAll("[role='dialog'], [data-radix-portal]"))
      .filter(el => (el as HTMLElement).offsetParent !== null)
      .map(el => ({
        role: el.getAttribute("role"),
        text: (el as HTMLElement).innerText?.substring(0, 200)?.trim(),
      }));

    // Toasts
    const toasts = Array.from(document.querySelectorAll("[data-sonner-toast], [role='status']"))
      .filter(el => (el as HTMLElement).offsetParent !== null)
      .map(el => (el as HTMLElement).innerText?.substring(0, 150)?.trim());

    // Errors visible on page
    const errors = Array.from(document.querySelectorAll("[role='alert'], .error, .text-red-500, .text-destructive"))
      .filter(el => (el as HTMLElement).offsetParent !== null)
      .map(el => (el as HTMLElement).innerText?.substring(0, 200)?.trim())
      .filter(Boolean);

    // Page heading
    const heading = document.querySelector("h1, h2, [data-testid*='page']");
    const pageTitle = heading ? (heading as HTMLElement).innerText?.substring(0, 100)?.trim() : null;

    // Visible forms
    const forms = Array.from(document.querySelectorAll("input:not([type='hidden']), textarea, select"))
      .filter(el => (el as HTMLElement).offsetParent !== null)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        testId: el.getAttribute("data-testid"),
        name: el.getAttribute("name"),
        placeholder: (el as HTMLInputElement).placeholder || null,
        value: (el as HTMLInputElement).value?.substring(0, 100) || "",
        type: (el as HTMLInputElement).type || null,
      }));

    return {
      route: sys.sidebarSection,
      editorTab: sys.editorTab,
      selectedPersonaId: agent.selectedPersonaId,
      personaCount: agent.personas.length,
      isCreatingPersona: sys.isCreatingPersona,
      isLoading: sys.isLoading,
      error: sys.error,
      pageTitle,
      modals,
      toasts,
      errors,
      forms,
    };
  },

  /** Type into a field identified by data-testid */
  fillField(testId: string, value: string) {
    const selector = `[data-testid="${testId}"]`;
    const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return { success: false, error: `Field not found: ${testId}` };
    const isTextArea = el instanceof HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return { success: true, testId, value };
  },

  /** Click an element by data-testid */
  clickTestId(testId: string) {
    const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    if (!el) return { success: false, error: `Element not found: ${testId}` };
    el.click();
    return { success: true, testId };
  },

  /** Wait for a toast/notification containing text */
  async waitForToast(text: string, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const toasts = document.querySelectorAll("[data-sonner-toast], [role='status'], [class*='toast']");
      for (const t of toasts) {
        if ((t as HTMLElement).innerText?.includes(text)) {
          return { success: true, text: (t as HTMLElement).innerText.substring(0, 200) };
        }
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return { success: false, error: `No toast with "${text}" within ${timeoutMs}ms` };
  },

  /** Search agents by typing into the search bar */
  searchAgents(query: string) {
    useSystemStore.getState().setSidebarSection("personas");
    const el = document.querySelector('[data-testid="agent-search"]') as HTMLInputElement | null;
    if (!el) return { success: false, error: "Agent search input not found" };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, query);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, query };
  },

  /** Set buildPersonaId without affecting other state */
  setBuildPersonaId(personaId: string) {
    useAgentStore.setState({ buildPersonaId: personaId });
    return { success: true, personaId };
  },

  /** Set buildSessionId directly */
  setBuildSessionId(sessionId: string) {
    useAgentStore.setState({ buildSessionId: sessionId });
    return { success: true, sessionId };
  },

  /** Simulate build state for testing (sets Zustand store directly) */
  simulateBuild(phase: string, personaId: string, cells: Record<string, string>, sessionId?: string) {
    useAgentStore.setState({
      buildPhase: phase as never,
      buildPersonaId: personaId,
      buildCellStates: cells as never,
      buildSessionId: sessionId ?? "test-session-sim",
    });
    if (phase === "analyzing" || phase === "resolving") {
      useSystemStore.getState().setIsCreatingPersona(true);
    }
    return { success: true, phase, personaId };
  },

  /** Answer a build question by cell key and option index (0-based) */
  answerBuildQuestion(cellKey: string, optionIndex: number) {
    // Find the answer button and click it to open the popover
    const buttons = document.querySelectorAll('button');
    let answerBtn: HTMLElement | null = null;
    for (const b of buttons) {
      if (b.innerText?.includes('Answer:') && b.offsetParent !== null) {
        answerBtn = b as HTMLElement;
        break;
      }
    }
    if (!answerBtn) return Promise.resolve({ success: false, error: 'No answer button visible' });
    answerBtn.click();
    // Wait a tick for popover to render, then click the option
    return new Promise<Record<string, unknown>>((resolve) => {
      setTimeout(() => {
        const options = document.querySelectorAll('[data-testid^="option-button-"]');
        if (optionIndex >= options.length) {
          resolve({ success: false, error: `Option index ${optionIndex} out of range (${options.length} options)` });
          return;
        }
        (options[optionIndex] as HTMLElement).click();
        resolve({ success: true, cellKey, optionIndex });
      }, 300);
    });
  },

  /** Delete an agent by name or ID with full cleanup */
  async deleteAgent(nameOrId: string) {
    const store = useAgentStore.getState();
    const match = store.personas.find(
      p => p.id === nameOrId || p.name.toLowerCase().includes(nameOrId.toLowerCase()),
    );
    if (!match) return { success: false, error: `No agent matching: ${nameOrId}` };
    try {
      await store.deletePersona(match.id);
      // Clean up build state if this was the active build persona
      if (store.buildPersonaId === match.id) {
        store.resetBuildSession();
      }
      return { success: true, deleted: match.name };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Navigate to settings and switch to a specific tab */
  openSettingsTab(tab: string) {
    useSystemStore.getState().setSidebarSection("settings");
    useSystemStore.getState().setSettingsTab(tab as never);
    return { success: true, tab };
  },

  /** Gap 4: Verify build state hydration after navigation round-trip */
  async verifyHydrationRoundTrip() {
    const before = useAgentStore.getState();
    if (!before.buildSessionId) {
      return { success: false, error: 'No active build session to test hydration' };
    }
    const beforeCells = { ...before.buildCellStates };
    const beforePhase = before.buildPhase;
    const beforeSessionId = before.buildSessionId;
    const beforeCellCount = Object.keys(beforeCells).length;

    // Navigate away
    useSystemStore.getState().setSidebarSection('settings');
    await new Promise(r => setTimeout(r, 500));

    // Navigate back
    useSystemStore.getState().setSidebarSection('personas');
    await new Promise(r => setTimeout(r, 1000));

    // Compare
    const after = useAgentStore.getState();
    const cellsMatch = JSON.stringify(beforeCells) === JSON.stringify(after.buildCellStates);
    const phaseMatch = beforePhase === after.buildPhase;
    const sessionMatch = beforeSessionId === after.buildSessionId;

    return {
      success: cellsMatch && phaseMatch && sessionMatch,
      details: {
        cellsMatch, phaseMatch, sessionMatch,
        beforeCellCount,
        afterCellCount: Object.keys(after.buildCellStates).length,
      },
    };
  },

  /** Gap 5: Verify concurrent build is rejected */
  async testConcurrentBuildRejection(personaId: string) {
    try {
      const { Channel } = await import('@tauri-apps/api/core');
      const ch = new Channel();
      await invoke('start_build_session', {
        channel: ch,
        personaId,
        intent: 'concurrent test intent',
        workflowJson: null,
        parserResultJson: null,
        language: null,
      });
      return { success: false, error: 'Second build was NOT rejected — expected rejection' };
    } catch (e: unknown) {
      const msg = unpackError(e);
      if (msg.includes('already active')) {
        return { success: true };
      }
      return { success: false, error: `Unexpected error: ${msg}` };
    }
  },

  /** Promote the current build draft — applies structured_prompt, tools, design context to persona. */
  async promoteBuildDraft() {
    const state = useAgentStore.getState();
    const sessionId = state.buildSessionId;
    if (!sessionId) {
      return { success: false, error: 'No active build session (no sessionId)' };
    }
    if (state.buildPhase !== 'draft_ready' && state.buildPhase !== 'test_complete') {
      return { success: false, error: `Cannot promote in phase: ${state.buildPhase}` };
    }
    // Resolve personaId: DB lookup is authoritative since buildPersonaId is often null
    let personaId = state.buildPersonaId;
    if (!personaId) {
      // Query backend for the persona_id linked to this build session
      try {
        const session = await invoke('get_active_build_session', { personaId: '' }) as { personaId?: string } | null;
        personaId = session?.personaId ?? null;
      } catch {
        // noop — try next fallback
      }
    }
    if (!personaId && state.personas.length > 0) {
      // Fallback: most recently created persona
      personaId = state.personas[state.personas.length - 1]?.id ?? null;
    }
    if (!personaId) {
      return { success: false, error: `No personaId found for session ${sessionId}` };
    }
    try {
      const result = await invoke('promote_build_draft', {
        sessionId,
        personaId,
      });
      // Refresh persona in store after promote
      await useAgentStore.getState().fetchPersonas();
      useAgentStore.getState().selectPersona(personaId);
      return { success: true, result, personaId };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Open the adoption modal for a template in Matrix mode.
   *  This navigates to Templates, finds the template, and opens the adoption wizard.
   *  Returns when the ChronologyAdoptionView is mounted. */
  async openMatrixAdoption(reviewId: string) {
    // Navigate to templates section
    useSystemStore.getState().setSidebarSection('design-reviews');
    // Set the template adopt active flag — this triggers the gallery to open the modal
    useSystemStore.getState().setTemplateAdoptActive(true);

    // Find the template review and open the adoption modal
    // We use a DOM-based approach: find the template row and click View Details, then Adopt
    const row = document.querySelector(`[data-testid="template-row-${reviewId}"]`);
    if (!row) return { success: false, error: `Template row not found: ${reviewId}` };

    // Expand the row first
    (row as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 500));

    // Find and click the action menu button (last button in the row)
    const btns = row.querySelectorAll('button');
    const menuBtn = btns[btns.length - 1];
    if (!menuBtn) return { success: false, error: 'Action menu button not found' };
    (menuBtn as HTMLElement).style.opacity = '1';
    (menuBtn as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 500));

    // Click "View Details" from the portal menu
    const allBtns = document.querySelectorAll('button');
    let detailBtn: HTMLElement | null = null;
    for (const b of allBtns) {
      if ((b as HTMLElement).textContent?.trim() === 'View Details') {
        detailBtn = b as HTMLElement;
        break;
      }
    }
    if (!detailBtn) return { success: false, error: 'View Details button not found' };
    detailBtn.click();
    await new Promise((r) => setTimeout(r, 1000));

    // Click "Adopt as Persona"
    const adoptBtn = document.querySelector('[data-testid="button-adopt-template"]') as HTMLElement;
    if (!adoptBtn) return { success: false, error: 'Adopt button not found in detail modal' };
    adoptBtn.click();
    await new Promise((r) => setTimeout(r, 1000));

    // Mode already defaults to 'matrix' so ChronologyAdoptionView should mount automatically.
    // Return immediately — the caller should poll /state for buildSessionId to appear.
    return { success: true, reviewId };
  },

  /** Instant-adopt a template to create a persona directly (no AI transform). */
  async adoptTemplate(templateName: string, designResultJson: string) {
    try {
      const result = await invoke('instant_adopt_template', {
        templateName,
        designResultJson,
      });
      await useAgentStore.getState().fetchPersonas();
      return { success: true, result };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e);
      return { success: false, error: msg };
    }
  },

  /** Execute a persona by ID or name. Returns the execution result. */
  async executePersona(nameOrId: string, useCaseId?: string | null) {
    const store = useAgentStore.getState();
    const match = store.personas.find(
      p => p.id === nameOrId || p.name.toLowerCase().includes(nameOrId.toLowerCase()),
    );
    if (!match) return { success: false, error: `No agent matching: ${nameOrId}` };
    try {
      const result = await invoke('execute_persona', {
        personaId: match.id,
        triggerId: null,
        inputData: null,
        useCaseId: useCaseId ?? null,
        continuation: null,
      });
      return { success: true, execution: result, personaName: match.name, useCaseId: useCaseId ?? null };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** 2026-05-05 — list use cases for a promoted persona. Used by the e2e
   *  rapid-validation suite to drive per-UC executions through the
   *  sub_use_cases module's manual-run path (executePersona with a
   *  useCaseId). Returns the parsed `useCases` array from
   *  design_context if present, otherwise an empty list. */
  listPersonaUseCases(nameOrId: string) {
    const store = useAgentStore.getState();
    const match = store.personas.find(
      p => p.id === nameOrId || p.name.toLowerCase().includes(nameOrId.toLowerCase()),
    );
    if (!match) return { success: false, error: `No agent matching: ${nameOrId}` };
    let designCtx: Record<string, unknown> | null = null;
    const raw = (match as unknown as { design_context?: unknown }).design_context;
    if (typeof raw === 'string') {
      try { designCtx = JSON.parse(raw) as Record<string, unknown>; } catch { designCtx = null; }
    } else if (raw && typeof raw === 'object') {
      designCtx = raw as Record<string, unknown>;
    }
    const ucs = (designCtx?.useCases ?? designCtx?.use_cases ?? []) as Array<{
      id?: string; useCaseId?: string; use_case_id?: string; title?: string;
    }>;
    const list = ucs.map((uc) => ({
      id: uc.id ?? uc.useCaseId ?? uc.use_case_id ?? null,
      title: uc.title ?? null,
    })).filter((u) => !!u.id);
    return { success: true, personaId: match.id, personaName: match.name, useCases: list };
  },

  /** C7 reference-input: answer a clarifying_question that carried
   *  `accepts_reference: true`, attaching either a local file path, an
   *  HTTPS URL, or inline text. Backend resolves + fences the reference
   *  into the answer before piping to the CLI. */
  async answerBuildQuestionWithReference(
    cellKey: string,
    answer: string,
    reference: { path?: string; url?: string; inlineContent?: string; name?: string },
  ) {
    const state = useAgentStore.getState();
    const sessionId = state.buildSessionId;
    if (!sessionId) {
      return { success: false, error: 'No active build session (no sessionId)' };
    }
    try {
      await invoke('answer_build_question', {
        sessionId,
        cellKey,
        answer,
        reference,
      });
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** C7 — fetch the active build session for a persona, with `agent_ir`
   *  parsed as JSON. Used by Phase G to find the first capability id
   *  pre-promote (where `personas.design_context` and
   *  `personas.last_design_result` are still NULL). Returns the
   *  `PersistedBuildSession` shape — `agentIr` is the typed IR the LLM
   *  built up over the conversation. */
  async getActiveBuildSession(personaId: string) {
    try {
      const session = await invoke('get_active_build_session', { personaId });
      return { success: true, session };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** C7 — delete a smee_relays row by id. Used for test cleanup. */
  async smeeRelayDelete(id: string) {
    try {
      await invoke('smee_relay_delete', { id });
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** C7 — list smee_relays rows. Used by Phase H to verify the
   *  promote-time auto-bind landed (smee_relays row created with the
   *  expected target_persona_id + event_filter). */
  async smeeRelayList() {
    try {
      const relays = await invoke('smee_relay_list');
      return { success: true, relays };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** C7 — list persona_manual_reviews rows, optionally filtered by
   *  persona_id + status. Used by Phase D to verify auto_triage landed
   *  reviews in `approved` / `rejected` (not `resolved`). */
  async listManualReviews(personaId?: string | null, status?: string | null) {
    try {
      const reviews = await invoke('list_manual_reviews', {
        personaId: personaId ?? null,
        status: status ?? null,
      });
      return { success: true, reviews };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** C7 — list policy_events rows for a given execution. Used by Phase D
   *  to verify the auto_triage second-pass evaluator emitted the right
   *  audit tag (review.auto_triage.approved / .rejected / .fallback). */
  async getPolicyEventsForExecution(executionId: string) {
    try {
      const events = await invoke('get_policy_events_for_execution', { executionId });
      return { success: true, events };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** C8 — Phase D2 helper. Synthesizes a `manual_review` row + spawns the
   *  auto_triage evaluator against an already-promoted persona, bypassing
   *  the LLM-runtime nondeterminism around when a `request_review` action
   *  is emitted. Backend command is gated by `#[cfg(feature =
   *  "test-automation")]` so it never ships in production builds. See
   *  `commands::testing::synthesize_review` for the semantics.
   *
   *  Args are positional (not packed into a single object) so the
   *  bridge-exec dispatcher's `parseParamNames` + `resolveArgs` can map
   *  Python's params dict by declared name. See bridge.ts:106-149 for the
   *  rationale — single-object param signatures fall back to alphabetical
   *  Object.values ordering, which scrambles arg positions. */
  async synthesizeManualReview(
    personaId: string,
    useCaseId: string | null,
    title: string,
    description: string | null,
    severity: string | null,
    contextData: string | null,
    suggestedActions: string[] | null,
  ) {
    try {
      const result = await invoke('synthesize_manual_review', {
        personaId,
        useCaseId: useCaseId ?? null,
        title,
        description: description ?? null,
        severity: severity ?? null,
        contextData: contextData ?? null,
        suggestedActions: suggestedActions ?? null,
      }) as { reviewId: string; executionId: string };
      return { success: true, ...result };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** C7 webhook source: answer a clarifying_question that carried
   *  `accepts_webhook_source: true`, attaching a smee.io URL (and optional
   *  comma-separated event_filter). Backend appends a fenced WEBHOOK
   *  SOURCE block to the answer text per session_prompt rule 24. */
  async answerBuildQuestionWithWebhookSource(
    cellKey: string,
    answer: string,
    webhookSource: { channelUrl: string; eventFilter?: string },
  ) {
    const state = useAgentStore.getState();
    const sessionId = state.buildSessionId;
    if (!sessionId) {
      return { success: false, error: 'No active build session (no sessionId)' };
    }
    try {
      await invoke('answer_build_question', {
        sessionId,
        cellKey,
        answer,
        webhookSource,
      });
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** C7 dry-run: simulate a capability against the draft persona without
   *  promoting. Snapshots a `design_context` onto the draft row, dispatches
   *  via execute_persona_inner with is_simulation=true, returns the
   *  PersonaExecution row. Backend: simulate_build_draft. */
  async simulateBuildDraft(useCaseId: string, inputOverride?: string | null) {
    const state = useAgentStore.getState();
    const sessionId = state.buildSessionId;
    if (!sessionId) {
      return { success: false, error: 'No active build session (no sessionId)' };
    }
    try {
      const execution = await invoke('simulate_build_draft', {
        sessionId,
        useCaseId,
        inputOverride: inputOverride ?? null,
      }) as { id: string; status?: string; persona_id?: string };
      return { success: true, execution };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** C7 dry-run: fetch the artefacts (manual reviews + memories) the
   *  simulation produced. Skips messages/events for v1 — those have no
   *  per-execution repo accessor yet. */
  async getSimulationArtefacts(executionId: string) {
    try {
      const artefacts = await invoke('get_simulation_artefacts', { executionId });
      return { success: true, artefacts };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Gap 6: Trigger test_build_draft for the active build session */
  async triggerBuildTest() {
    const state = useAgentStore.getState();
    if (!state.buildSessionId || !state.buildPersonaId) {
      return { success: false, error: 'No active build session' };
    }
    if (state.buildPhase !== 'draft_ready' && state.buildPhase !== 'test_complete') {
      return { success: false, error: `Cannot test in phase: ${state.buildPhase}` };
    }
    try {
      const report = await invoke('test_build_draft', {
        sessionId: state.buildSessionId,
        personaId: state.buildPersonaId,
      });
      return { success: true, report };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Phase C2 — fetch a persona's detail including design_context, triggers,
   *  subscriptions. Used by the sweep harness to validate the post-adoption
   *  shape (useCases populated, triggers carry use_case_id, etc.).
   *  See `docs/guide-adoption-test-framework.md` §D. */
  async getPersonaDetail(personaId: string) {
    try {
      const detail = await invoke('get_persona_detail', { id: personaId });
      return { success: true, detail };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** List every persona — for cleanup helpers and visibility probes. */
  async listPersonas() {
    try {
      const rows = await invoke<Array<Record<string, unknown>>>('list_personas');
      return {
        success: true,
        personas: rows.map((p) => ({
          id: p.id,
          name: p.name,
          enabled: p.enabled,
          group_id: p.group_id ?? null,
          template_category: p.template_category ?? null,
          trust_origin: p.trust_origin ?? null,
          created_at: p.created_at ?? null,
        })),
      };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Permanently delete a persona by id. Used by scenario runners to clean
   *  up duplicates between runs so a single drive event doesn't fan out to
   *  every prior copy of the persona. */
  async deletePersona(personaId: string) {
    try {
      await invoke('delete_persona', { id: personaId });
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Introspect a promoted persona's IR — trigger / connectors / event_subs
   *  per use case. Lets scenario runners assert the build's structural
   *  outcome without poking SQLite or the get_persona response shape. */
  async getPersonaIr(personaId: string) {
    try {
      const detail = await invoke<Record<string, unknown>>('get_persona_detail', { id: personaId });
      const triggers = (detail.triggers as Array<Record<string, unknown>> | undefined) ?? [];
      const subscriptions = (detail.subscriptions as Array<Record<string, unknown>> | undefined) ?? [];
      const tools = (detail.tools as Array<Record<string, unknown>> | undefined) ?? [];
      return {
        success: true,
        triggers: triggers.map((t) => ({
          id: t.id,
          trigger_type: t.trigger_type,
          trigger_config: t.trigger_config,
          enabled: t.enabled,
          ...t,
        })),
        subscriptions: subscriptions.map((s) => ({
          event_type: s.event_type,
          source_filter: s.source_filter,
          direction: s.direction,
          use_case_id: s.use_case_id,
        })),
        toolNames: tools.map((t) => t.name),
        notification_channels: detail.notification_channels ?? null,
        warnings: detail.warnings ?? [],
      };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Phase B helper — patch a persona_event_subscription's source_filter so a
   *  cross-persona chain can fire. The bus self-scopes persona-sourced events
   *  to the emitting persona unless the subscription has an explicit
   *  source_filter; setting it to "*" opts that subscription into receiving
   *  events from any persona. Used only by chained-persona scenarios. */
  async patchSubscriptionSourceFilter(subscriptionId: string, filter: string) {
    try {
      // Rust's serde with default rename rules expects snake_case keys for
      // the inner Input struct (it has no #[serde(rename_all = "camelCase")]
      // on UpdateEventSubscriptionInput). The outer command parameter
      // (`input`) IS auto-mapped, but the struct fields are not.
      const result = await invoke('update_subscription', {
        id: subscriptionId,
        input: { source_filter: filter, event_type: null, enabled: null },
      });
      return { success: true, result };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Phase B helper — patch a persona_trigger's config to add a source_filter.
   *  Mirrors patchSubscriptionSourceFilter for the unified event_listener
   *  trigger path. The new config replaces the old config wholesale. */
  async patchTriggerSourceFilter(triggerId: string, personaId: string, filter: string) {
    try {
      const detail = await invoke<{ triggers?: Array<Record<string, unknown>> }>(
        'get_persona_detail',
        { id: personaId },
      );
      const triggers = detail.triggers ?? [];
      const trig = triggers.find((t) => (t as { id?: string }).id === triggerId);
      if (!trig) return { success: false, error: `trigger ${triggerId} not found on ${personaId}` };
      const cfgRaw = (trig as { config?: string }).config ?? '{}';
      let cfgObj: Record<string, unknown>;
      try {
        cfgObj = JSON.parse(cfgRaw);
      } catch {
        cfgObj = {};
      }
      cfgObj.source_filter = filter;
      const newCfg = JSON.stringify(cfgObj);
      const result = await invoke('update_trigger', {
        id: triggerId,
        personaId,
        input: { trigger_type: null, config: newCfg, enabled: null, next_trigger_at: null },
      });
      return { success: true, result };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Get artifact counts for a persona across all overview modules. */
  async getOverviewCounts(personaId: string) {
    try {
      const [execs, memories, reviews] = await Promise.all([
        invoke<unknown[]>('list_executions', { personaId, limit: 500 }),
        invoke<unknown[]>('list_memories', { personaId }),
        invoke<unknown[]>('list_manual_reviews', { personaId }),
      ]);
      // Messages and events need filtering by persona
      const [msgs, events] = await Promise.all([
        invoke<unknown[]>('list_messages', { limit: 500, offset: 0 }),
        invoke<unknown[]>('list_events', { limit: 500 }),
      ]);
      const filteredMsgs = (msgs as Array<{ persona_id: string }>).filter(m => m.persona_id === personaId);
      const filteredEvents = (events as Array<{ source_id?: string; target_persona_id?: string }>).filter(
        e => e.source_id === personaId || e.target_persona_id === personaId,
      );
      return {
        success: true,
        executions: (execs as unknown[]).length,
        messages: filteredMsgs.length,
        memories: (memories as unknown[]).length,
        events: filteredEvents.length,
        reviews: (reviews as unknown[]).length,
      };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /**
   * Read a single execution row by id. Used by the model-calibration
   * harness to poll for terminal exec status before capturing
   * artifacts (so we never see `status=running` in the per-scenario
   * JSON reports).
   */
  async getExecution(id: string) {
    try {
      const execution = await invoke<unknown>('get_execution', { id });
      return { success: true, execution };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /**
   * Return content-rich artifacts for a persona — the messages, memories,
   * manual-review entries, and execution rows that landed since promote.
   * Used by the model-calibration harness so an external judge can read
   * what each model actually produced (vs. just counts).
   *
   * Limits are conservative — the harness fires a single execution per
   * persona, so there's rarely more than a handful of rows. The cap
   * (50 each) keeps the JSON response under typical pipe-through limits.
   */
  async getPersonaArtifacts(personaId: string) {
    try {
      const [executions, messagesAll, memories, reviews] = await Promise.all([
        invoke<unknown[]>('list_executions', { personaId, limit: 50 }),
        invoke<unknown[]>('list_messages', { limit: 200, offset: 0 }),
        invoke<unknown[]>('list_memories', { personaId }),
        invoke<unknown[]>('list_manual_reviews', { personaId }),
      ]);
      const messages = (messagesAll as Array<{ persona_id?: string; personaId?: string }>)
        .filter((m) => (m.persona_id ?? m.personaId) === personaId)
        .slice(0, 50);
      return {
        success: true,
        executions,
        messages,
        memories,
        reviews,
      };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /**
   * Force the model on a persona for testing — overrides the persona-level
   * `model_profile` AND every use-case-level `model_override` in the
   * persona's `design_context`. Intended for the model-calibration harness
   * to run the same IR against Haiku/Sonnet/Opus.
   *
   * Returns the merged design_context that was written so the caller can
   * verify the override landed.
   */
  async forcePersonaModel(personaId: string, model: string) {
    try {
      const detail = await invoke<{ design_context: string | null }>('get_persona', { id: personaId });
      let dc: { useCases?: Array<Record<string, unknown>>; use_cases?: Array<Record<string, unknown>> } = {};
      if (detail.design_context) {
        try {
          dc = JSON.parse(detail.design_context);
        } catch {
          dc = {};
        }
      }
      const ucs = (dc.useCases ?? dc.use_cases ?? []) as Array<Record<string, unknown>>;
      for (const uc of ucs) {
        uc.model_override = model;
      }
      // Mirror through under both keys so consumers reading either spelling see the override.
      if (dc.useCases) dc.useCases = ucs;
      if (dc.use_cases) dc.use_cases = ucs;
      if (!dc.useCases && !dc.use_cases && ucs.length > 0) dc.useCases = ucs;
      const newDesignContext = JSON.stringify(dc);
      const newModelProfile = JSON.stringify({ model });
      await invoke('update_persona', {
        id: personaId,
        input: {
          model_profile: newModelProfile,
          design_context: newDesignContext,
        },
      });
      return { success: true, useCases: ucs.length, model };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /**
   * List service_types for which a local CLI capture spec exists AND the
   * binary is installed and allowlisted on this machine.
   */
  async listCliCapturable() {
    try {
      const services = await invoke<string[]>("list_cli_capturable_services");
      return { success: true, services };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /**
   * Run the CLI capture spec for `serviceType`. Returns captured field keys
   * (never the secret values) and the expiry metadata so tests can assert
   * without touching the raw token.
   */
  async cliCaptureRun(serviceType: string) {
    try {
      const result = await invoke<{
        service_type: string;
        fields: Record<string, string>;
        token_ttl_seconds: number | null;
        captured_at: string;
        expires_at: string | null;
      }>("cli_capture_run", { serviceType });
      return {
        success: true,
        serviceType: result.service_type,
        fieldKeys: Object.keys(result.fields),
        fieldCount: Object.keys(result.fields).length,
        tokenTtlSeconds: result.token_ttl_seconds,
        capturedAt: result.captured_at,
        expiresAt: result.expires_at,
      };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  // ── Build-from-scratch scenario helpers ──────────────────────────────
  //
  // These drive the full chronological flow used by the translation
  // scenario (docs/guide-adoption-test-framework.md §E):
  //
  //   startBuildFromIntent(intent)       — types intent + clicks Launch
  //   answerPendingBuildQuestions(map)   — batch-submits text answers
  //   waitForBuildPhase(phase, timeoutMs)
  //   promoteBuildDraft()                — already defined above
  //   driveWriteText(path, content)      — fires drive.document.added
  //   driveReadText(path)                — reads a document back
  //   waitForPersonaExecution(personaId, sinceIso, timeoutMs)

  /**
   * Type intent into UnifiedBuildEntry's textarea and click Launch.
   * Returns once startBuildSession resolves (buildSessionId set in store).
   */
  async startBuildFromIntent(intent: string, timeoutMs: number = 30000) {
    // Match startCreateAgent's ordering: clear the selected persona
    // BEFORE toggling isCreatingPersona, otherwise the
    // selectedPersonaId-branch in PersonasPage can render PersonaEditor
    // first and race the matrix mount.
    // Also reset any lingering build session from a prior scenario run —
    // GlyphFullLayout's pre-build intent textarea is gated on
    // `!hasDesignResult`, so a leftover `test_complete` session would hide
    // the textarea and fail this method with "not visible after 15s".
    useAgentStore.getState().resetBuildSession();
    useAgentStore.getState().selectPersona(null);
    useSystemStore.getState().setIsCreatingPersona(true);
    useSystemStore.getState().setSidebarSection('personas');
    // The pre-build entry surface evolved across three iterations:
    //   1. Legacy: a single always-visible `agent-intent-input` textarea.
    //   2. CommandPanelComposer: per-row inputs (`composer-row-task`, …).
    //   3. C8 Glyph redesign: form is hidden until the user clicks the
    //      sigil's centre — `[data-testid="glyph-compose-summon"]`. The
    //      composer renders inside an overlay only after the summon
    //      button fires.
    // Probe the inputs first; if none are visible, click the summon
    // button to open the overlay and probe again.
    const mountDeadline = Date.now() + 15_000;
    let target: HTMLTextAreaElement | HTMLInputElement | null = null;
    const probeSelectors = [
      '[data-testid="agent-intent-input"]',
      '[data-testid="composer-row-task"]',
    ];
    const findTarget = (): HTMLTextAreaElement | HTMLInputElement | null => {
      for (const sel of probeSelectors) {
        const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(sel);
        if (el && (el as HTMLElement).offsetParent !== null) return el;
      }
      return null;
    };
    while (Date.now() < mountDeadline) {
      target = findTarget();
      if (target) break;
      // Form not visible yet — try the summon path. This is a no-op
      // when the form is already mounted (button absent/disabled), so
      // it doesn't fight legacy layouts.
      const summon = document.querySelector<HTMLButtonElement>('[data-testid="glyph-compose-summon"]');
      if (summon && summon.offsetParent !== null && !summon.disabled) {
        summon.click();
        // Give the overlay's enter animation a moment to commit before
        // re-probing — the framer-motion enter is ~320ms.
        await new Promise((r) => setTimeout(r, 350));
      } else {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    if (!target || (target as HTMLElement).offsetParent === null) {
      return { success: false, error: `intent input not visible after 15s (probed ${probeSelectors.join(', ')}, also tried summon button)` };
    }
    const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(target, intent);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));

    const btn = document.querySelector<HTMLButtonElement>('[data-testid="agent-launch-btn"]');
    if (!btn || btn.offsetParent === null) {
      return { success: false, error: 'agent-launch-btn not visible' };
    }
    if (btn.disabled) return { success: false, error: 'agent-launch-btn is disabled (intent empty or already building?)' };
    btn.click();

    // Poll buildSessionId appearing in the store — that's the signal the
    // backend start_build_session call resolved.
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const s = useAgentStore.getState();
      if (s.buildSessionId) {
        return {
          success: true,
          sessionId: s.buildSessionId,
          personaId: s.buildPersonaId,
          phase: s.buildPhase,
        };
      }
      if (s.buildError) {
        return { success: false, error: `buildError: ${s.buildError}` };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return { success: false, error: 'Timed out waiting for buildSessionId' };
  },

  /**
   * Batch-answer the currently-pending build questions.
   * `answers` maps cellKey (use-cases, connectors, triggers, human-review,
   * messages, events, memory, error-handling) to a free-text string. Keys
   * for which no question is currently pending are silently dropped.
   */
  async answerPendingBuildQuestions(answers: Record<string, string>) {
    // `useAgentStore.getState()` returns a snapshot; subsequent actions do
    // not mutate it. We re-fetch after collecting so `buildPendingAnswers`
    // reflects the post-collect state rather than the pre-collect snapshot.
    const snap1 = useAgentStore.getState();
    if (!snap1.buildSessionId) return { success: false, error: 'No active build session' };
    const pending = snap1.buildPendingQuestions ?? [];
    const pendingKeys = new Set((pending as Array<{ cellKey: string }>).map((q) => q.cellKey));

    // Collect every provided key that matches a pending question.
    let collectedNow = 0;
    for (const [cellKey, answer] of Object.entries(answers)) {
      if (!pendingKeys.has(cellKey)) continue;
      snap1.collectAnswer(cellKey, answer);
      collectedNow += 1;
    }
    if (collectedNow === 0) {
      return {
        success: false,
        error: 'No provided cellKeys match pending questions',
        pendingKeys: Array.from(pendingKeys),
        providedKeys: Object.keys(answers),
      };
    }

    // Re-read to get the post-collect snapshot.
    const snap2 = useAgentStore.getState();
    const collected = snap2.buildPendingAnswers;
    const entries = Object.entries(collected);
    if (entries.length === 0) {
      return {
        success: false,
        error: 'Collected answers not present in store after collectAnswer',
      };
    }

    const escapeAnswer = (raw: string): string =>
      raw.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/\[/g, '\\[');
    const combined = entries
      .map(([k, v]) => `[${k}]: ${escapeAnswer(v)}`)
      .join('\n');

    try {
      await invoke('answer_build_question', {
        sessionId: snap2.buildSessionId,
        cellKey: '_batch',
        answer: combined,
      });
      snap2.clearPendingAnswers();
      return { success: true, answered: entries.map(([k]) => k) };
    } catch (e: unknown) {
      return { success: false, error: _fmtBridgeErr(e) };
    }
  },

  /** Poll until `buildPhase` reaches one of the target phases, or the
   *  build surfaces an error. Sliced at 20s so the outer `__exec__`
   *  25s rejection can never fire — callers poll repeatedly until their
   *  own wall budget expires. The returned object ALWAYS carries `phase`
   *  so a timeout result is still actionable. */
  async waitForBuildPhase(phases: string[] | string, timeoutMs: number = 20_000) {
    const targets = Array.isArray(phases) ? phases : [phases];
    const slice = Math.min(timeoutMs, 20_000);
    const start = Date.now();
    while (Date.now() - start < slice) {
      const s = useAgentStore.getState();
      if (s.buildError) {
        return { success: false, error: `buildError: ${s.buildError}`, phase: s.buildPhase, pendingCount: (s.buildPendingQuestions ?? []).length };
      }
      if (targets.includes(s.buildPhase as string)) {
        return { success: true, phase: s.buildPhase, pendingCount: (s.buildPendingQuestions ?? []).length };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    const finalState = useAgentStore.getState();
    return {
      success: false,
      timedOut: true,
      phase: finalState.buildPhase,
      pendingCount: (finalState.buildPendingQuestions ?? []).length,
      sessionId: finalState.buildSessionId,
    };
  },

  /** List currently pending build questions. */
  listPendingBuildQuestions() {
    const pending = useAgentStore.getState().buildPendingQuestions ?? [];
    return { success: true, questions: pending };
  },

  /** Write a text document through the built-in Local Drive. Triggers
   *  `drive.document.added` (or edited if the path already existed). */
  async driveWriteText(relPath: string, content: string) {
    if (!relPath) return { success: false, error: 'driveWriteText: relPath missing' };
    try {
      const entry = await invoke('drive_write_text', { relPath, content });
      return { success: true, entry };
    } catch (e: unknown) {
      return { success: false, error: _fmtBridgeErr(e) };
    }
  },

  /** Read a text document from Local Drive (for asserting translated output). */
  async driveReadText(relPath: string) {
    try {
      const content = await invoke<string>('drive_read_text', { relPath });
      return { success: true, content };
    } catch (e: unknown) {
      return { success: false, error: _fmtBridgeErr(e) };
    }
  },

  /** List a folder's entries (smoke-check the drive before/after writes). */
  async driveList(relPath: string = '') {
    try {
      const entries = await invoke<unknown[]>('drive_list', { relPath });
      return { success: true, count: (entries as unknown[]).length, entries };
    } catch (e: unknown) {
      return { success: false, error: _fmtBridgeErr(e) };
    }
  },

  /** Poll list_executions for a persona until a row appears at/after
   *  `sinceIso` with a terminal status. Sliced at 20s so the __exec__
   *  25s rejection can't fire — the Python runner loops per-slice. */
  async waitForPersonaExecution(personaId: string, sinceIso: string, timeoutMs: number = 20_000) {
    const sinceMs = Date.parse(sinceIso);
    const slice = Math.min(timeoutMs, 20_000);
    const start = Date.now();
    while (Date.now() - start < slice) {
      try {
        const rows = await invoke<Array<Record<string, unknown>>>('list_executions', {
          personaId, limit: 20,
        });
        const recent = (rows as Array<{ started_at?: string; status?: string }>)
          .filter((r) => {
            const ts = r.started_at ? Date.parse(r.started_at) : NaN;
            return Number.isFinite(ts) && ts >= sinceMs;
          });
        const done = recent.find((r) => ['completed', 'failed', 'cancelled'].includes(String(r.status)));
        if (done) return { success: true, execution: done, seen: recent.length };
      } catch {
        // swallow — keep polling
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    // Slice expired with no execution yet — let the caller loop.
    return { success: false, timedOut: true, personaId };
  },

  /** Get workspace export statistics — wraps the same Tauri command the
   *  Data Portability settings panel calls. Used by e2e_portability.py to
   *  capture a baseline before round-tripping. */
  async getPortabilityStats() {
    try {
      const stats = await invoke<Record<string, unknown>>('get_export_stats');
      return { success: true, stats };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Debug-only round-trip helper: export selected personas/teams/credentials
   *  to a known path, bypassing the OS save dialog. The Tauri command is
   *  gated by #[cfg(debug_assertions)] so this only works in dev builds. */
  async exportPortabilityToPath(
    personaIds: string[],
    teamIds: string[],
    credentialIds: string[],
    passphrase: string | null,
    filePath: string,
  ) {
    try {
      const wrote = await invoke<boolean>('export_selective_to_path', {
        personaIds,
        teamIds,
        credentialIds,
        passphrase,
        filePath,
      });
      return { success: true, wrote, filePath };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** Debug-only round-trip helper: import a portability bundle from a known
   *  path, bypassing the OS file picker. Returns the PortabilityImportResult
   *  shape so the smoke test can assert on counts and warnings. */
  async importPortabilityFromPath(passphrase: string | null, filePath: string) {
    try {
      const result = await invoke<Record<string, unknown> | null>(
        'import_portability_bundle_from_path',
        { passphrase, filePath },
      );
      return { success: true, result };
    } catch (e: unknown) {
      return { success: false, error: unpackError(e) };
    }
  },

  /** List available credential service types from the vault. */
  listCredentials() {
    const creds = useVaultStore.getState().credentials;
    const connectorDefs = useVaultStore.getState().connectorDefinitions;
    const serviceTypes = creds.map(c => {
      const def = connectorDefs.find(d => d.name === c.service_type);
      return {
        id: c.id,
        name: c.name,
        serviceType: c.service_type,
        label: def?.label ?? c.service_type,
        category: def?.category ?? 'unknown',
      };
    });
    return { success: true, credentials: serviceTypes };
  },

  /**
   * Companion (Athena) state snapshot — used by `tests/playwright/`.
   * Returns everything an end-to-end conversation test needs in one
   * round-trip: panel visibility, streaming flag, message bubbles
   * (in DOM order with role + truncated text), pending approvals
   * count, and brain inventory (episodes / facts / reflections via
   * direct invoke calls so the test exercises the real listing path).
   *
   * Truncation is applied to bubble text to keep payloads small —
   * tests usually only care about whether the prompt landed and
   * whether *something* came back, not the full assistant essay.
   */
  async companionInspect(): Promise<{
    panelVisible: boolean;
    streaming: boolean;
    messages: Array<{ role: string; text: string }>;
    streamingText: string | null;
    approvals: number;
    brain: {
      episodes: number;
      reflections: number;
      facts: { user: number; project: number; world: number };
      procedurals: number;
      goals: number;
      rituals: number;
      backlog: number;
    };
  }> {
    const panel = document.querySelector('[data-testid="companion-panel"]');
    if (!panel) {
      return {
        panelVisible: false,
        streaming: false,
        messages: [],
        streamingText: null,
        approvals: 0,
        brain: await collectBrainCounts(),
      };
    }
    const streaming = panel.getAttribute("data-companion-streaming") === "true";
    const bubbles = Array.from(
      panel.querySelectorAll("[data-companion-bubble-role]"),
    );
    const persisted = bubbles.filter(
      (b) => b.getAttribute("data-testid") !== "companion-bubble-streaming",
    );
    const messages = persisted
      .map((b) => ({
        role: b.getAttribute("data-companion-bubble-role") || "unknown",
        index: Number(b.getAttribute("data-companion-bubble-index") || 0),
        text: ((b.textContent || "").trim()).slice(0, 400),
      }))
      .sort((a, b) => a.index - b.index)
      .map(({ role, text }) => ({ role, text }));
    const streamingEl = panel.querySelector(
      '[data-testid="companion-bubble-streaming"]',
    );
    const streamingText = streamingEl
      ? ((streamingEl.textContent || "").trim()).slice(0, 400)
      : null;
    return {
      panelVisible: true,
      streaming,
      messages,
      streamingText,
      approvals: panel.querySelectorAll("[data-companion-approval]").length,
      brain: await collectBrainCounts(),
    };
  },

  /**
   * Dispatcher called from Rust via eval().
   * Executes a bridge method and sends the result back via Tauri IPC.
   * Includes a 25s timeout to prevent bridge queue blocking.
   */
  async __exec__(id: string, method: string, params: Record<string, unknown>) {
    // Long-running methods like openMatrixAdoption need more time
    const LONG_METHODS = new Set(['openMatrixAdoption', 'adoptTemplate', 'promoteBuildDraft']);
    const EXEC_TIMEOUT = LONG_METHODS.has(method) ? 90000 : 25000;
    try {
      const fn = (this as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") throw new Error(`Unknown method: ${method}`);
      // Named-arg dispatch. Rust's serde_json (no preserve_order feature)
      // serialises params alphabetically, so a naive Object.values(params)
      // gives ALPHABETICAL order of keys — breaks any method where the
      // declared positional order differs (driveWriteText(relPath, content)
      // would receive (content, relPath)). We parse the method's declared
      // parameter names from fn.toString() and pull arg values by name. When
      // the source can't be parsed (minified builds, destructured params),
      // we fall back to Object.values so single-arg positional methods keep
      // working as before.
      const args = resolveArgs(fn as (...a: unknown[]) => unknown, params);

      // Race the method call against a timeout to prevent queue blocking
      const result = await Promise.race([
        (fn as (...a: unknown[]) => unknown).apply(this, args),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Bridge method '${method}' timed out after ${EXEC_TIMEOUT / 1000}s`)), EXEC_TIMEOUT)),
      ]);

      await invoke("__test_respond", { id, result: JSON.stringify(result) });
    } catch (e: unknown) {
      const msg = unpackError(e);
      await invoke("__test_respond", { id, result: JSON.stringify({ error: msg }) });
    }
  },
};

// ── Companion test helpers ──────────────────────────────────────────────────

async function collectBrainCounts(): Promise<{
  episodes: number;
  reflections: number;
  facts: { user: number; project: number; world: number };
  procedurals: number;
  goals: number;
  rituals: number;
  backlog: number;
}> {
  const safeList = async (kind: string): Promise<number> => {
    try {
      const items = await invoke<unknown[]>("companion_list_brain_items", { kind });
      return Array.isArray(items) ? items.length : 0;
    } catch {
      // First run: companion brain isn't initialized yet — counts are 0
      // and the test harness shouldn't blow up on a benign missing-tab.
      return 0;
    }
  };
  const [
    episodes, reflections, factUser, factProject, factWorld,
    procedurals, goals, rituals, backlog,
  ] = await Promise.all([
    safeList("episode"),
    safeList("reflection"),
    safeList("fact:user"),
    safeList("fact:project"),
    safeList("fact:world"),
    safeList("procedural"),
    safeList("goal"),
    safeList("ritual"),
    safeList("backlog"),
  ]);
  return {
    episodes,
    reflections,
    facts: { user: factUser, project: factProject, world: factWorld },
    procedurals,
    goals,
    rituals,
    backlog,
  };
}

// Expose on window for Rust eval() access
(window as unknown as Record<string, unknown>).__TEST__ = bridge;
// Expose stores for direct state manipulation in e2e tests
(window as unknown as Record<string, unknown>).__AGENT_STORE__ = useAgentStore;
(window as unknown as Record<string, unknown>).__SYSTEM_STORE__ = useSystemStore;
(window as unknown as Record<string, unknown>).__OVERVIEW_STORE__ = useOverviewStore;
(window as unknown as Record<string, unknown>).__VAULT_STORE__ = useVaultStore;
console.log("[test-automation] Bridge loaded — window.__TEST__ ready");

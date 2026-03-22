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
import { sections as sidebarSections } from "@/features/shared/components/layout/sidebar/sidebarData";
import { isTierVisible, TIERS, type Tier } from "@/lib/constants/uiModes";
import type { SidebarSection } from "@/lib/types/types";

const VALID_SECTIONS: SidebarSection[] = [
  "home", "overview", "personas", "events", "credentials",
  "design-reviews", "team", "cloud", "settings", "dev-tools",
];

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
  __exec__(id: string, method: string, params: Record<string, unknown>): Promise<void>;
  [key: string]: unknown;
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
  navigate(section: string) {
    if (!VALID_SECTIONS.includes(section as SidebarSection)) {
      return { success: false, error: `Invalid section: ${section}. Valid: ${VALID_SECTIONS.join(", ")}` };
    }
    // Check tier gating: the Sidebar component will redirect inaccessible sections
    // back to home via useEffect — surface that early so callers get honest feedback.
    const def = sidebarSections.find((s) => s.id === section);
    if (def) {
      const tier = useSystemStore.getState().viewMode as Tier;
      const minTier = def.minTier ?? TIERS.STARTER;
      if (!isTierVisible(minTier, tier)) {
        return { success: false, error: `Section "${section}" requires tier "${minTier}" (current: "${tier}")` };
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
      // UI state
      viewMode: sys.viewMode,
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

  /** Select an agent by name (partial match) or ID */
  selectAgent(nameOrId: string) {
    const store = useAgentStore.getState();
    const match = store.personas.find(
      p => p.id === nameOrId || p.name.toLowerCase().includes(nameOrId.toLowerCase()),
    );
    if (!match) return { success: false, error: `No agent matching: ${nameOrId}` };
    store.selectPersona(match.id);
    return { success: true, id: match.id, name: match.name };
  },

  /** Navigate to a specific editor tab for the currently selected agent */
  openEditorTab(tab: string) {
    const validTabs = ["use-cases", "prompt", "lab", "connectors", "chat", "design", "health", "settings"];
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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
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
      const msg = e instanceof Error ? e.message : String(e);
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
        const session = await invoke('get_active_build_session', { personaId: '' }) as { persona_id?: string } | null;
        personaId = session?.persona_id ?? null;
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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  /** Execute a persona by ID or name. Returns the execution result. */
  async executePersona(nameOrId: string) {
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
        useCaseId: null,
        continuation: null,
      });
      return { success: true, execution: result, personaName: match.name };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  /**
   * Dispatcher called from Rust via eval().
   * Executes a bridge method and sends the result back via Tauri IPC.
   * Includes a 25s timeout to prevent bridge queue blocking.
   */
  async __exec__(id: string, method: string, params: Record<string, unknown>) {
    const EXEC_TIMEOUT = 25000;
    try {
      const fn = (this as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") throw new Error(`Unknown method: ${method}`);
      const args = Object.values(params);

      // Race the method call against a timeout to prevent queue blocking
      const result = await Promise.race([
        fn.apply(this, args),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Bridge method '${method}' timed out after ${EXEC_TIMEOUT / 1000}s`)), EXEC_TIMEOUT)),
      ]);

      await invoke("__test_respond", { id, result: JSON.stringify(result) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await invoke("__test_respond", { id, result: JSON.stringify({ error: msg }) });
    }
  },
};

// Expose on window for Rust eval() access
(window as unknown as Record<string, unknown>).__TEST__ = bridge;
// Expose stores for direct state manipulation in e2e tests
(window as unknown as Record<string, unknown>).__AGENT_STORE__ = useAgentStore;
(window as unknown as Record<string, unknown>).__SYSTEM_STORE__ = useSystemStore;
console.log("[test-automation] Bridge loaded — window.__TEST__ ready");

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
import { isTierVisible, TIERS, type Tier } from "@/lib/constants/uiModes";
import type { SidebarSection } from "@/lib/types/types";

const VALID_SECTIONS: SidebarSection[] = [
  "home", "overview", "personas", "events", "credentials",
  "design-reviews", "plugins", "settings",
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
      buildTestPassed: agent.buildTestPassed ?? null,
      buildTestError: agent.buildTestError ?? null,
      buildTestOutputLines: agent.buildTestOutputLines,
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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  /** Open the adoption modal for a template in Matrix mode.
   *  This navigates to Templates, finds the template, and opens the adoption wizard.
   *  Returns when the MatrixAdoptionView is mounted. */
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

    // Mode already defaults to 'matrix' so MatrixAdoptionView should mount automatically.
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

  /** Phase C2 — fetch a persona's detail including design_context, triggers,
   *  subscriptions. Used by the sweep harness to validate the post-adoption
   *  shape (useCases populated, triggers carry use_case_id, etc.).
   *  See `docs/guide-adoption-test-framework.md` §D. */
  async getPersonaDetail(personaId: string) {
    try {
      const detail = await invoke('get_persona_detail', { id: personaId });
      return { success: true, detail };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
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
   * Type intent into UnifiedMatrixEntry's textarea and click Launch.
   * Returns once startBuildSession resolves (buildSessionId set in store).
   */
  async startBuildFromIntent(intent: string, timeoutMs: number = 30000) {
    useSystemStore.getState().setIsCreatingPersona(true);
    useSystemStore.getState().setSidebarSection('personas');
    useAgentStore.getState().selectPersona(null);
    await new Promise((r) => setTimeout(r, 400));

    // Matrix command center uses stable testids (MatrixCommandCenterParts.tsx).
    const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="agent-intent-input"]');
    if (!ta || (ta as HTMLElement).offsetParent === null) {
      return { success: false, error: 'agent-intent-input textarea not visible' };
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(ta, intent);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
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
    const store = useAgentStore.getState();
    if (!store.buildSessionId) return { success: false, error: 'No active build session' };
    const pending = store.buildPendingQuestions ?? [];
    const pendingKeys = new Set((pending as Array<{ cellKey: string }>).map((q) => q.cellKey));

    for (const [cellKey, answer] of Object.entries(answers)) {
      if (!pendingKeys.has(cellKey)) continue;
      store.collectAnswer(cellKey, answer);
    }

    const collected = store.buildPendingAnswers;
    const collectedCount = Object.keys(collected).length;
    if (collectedCount === 0) {
      return { success: false, error: 'No provided cellKeys match pending questions', pendingKeys: Array.from(pendingKeys) };
    }

    const escapeAnswer = (raw: string): string =>
      raw.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/\[/g, '\\[');
    const combined = Object.entries(collected)
      .map(([k, v]) => `[${k}]: ${escapeAnswer(v)}`)
      .join('\n');

    try {
      await invoke('answer_build_question', {
        sessionId: store.buildSessionId,
        cellKey: '_batch',
        answer: combined,
      });
      store.clearPendingAnswers();
      return { success: true, answered: Object.keys(collected) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  /** Poll until `buildPhase` reaches one of the target phases, or the
   *  build surfaces an error. Useful for barriers between scenario steps. */
  async waitForBuildPhase(phases: string[] | string, timeoutMs: number = 120_000) {
    const targets = Array.isArray(phases) ? phases : [phases];
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const s = useAgentStore.getState();
      if (s.buildError) {
        return { success: false, error: `buildError: ${s.buildError}`, phase: s.buildPhase };
      }
      if (targets.includes(s.buildPhase as string)) {
        return { success: true, phase: s.buildPhase, pendingCount: (s.buildPendingQuestions ?? []).length };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    const final = useAgentStore.getState().buildPhase;
    return { success: false, error: `Timed out waiting for ${targets.join('|')} (stuck at ${final})`, phase: final };
  },

  /** List currently pending build questions. */
  listPendingBuildQuestions() {
    const pending = useAgentStore.getState().buildPendingQuestions ?? [];
    return { success: true, questions: pending };
  },

  /** Write a text document through the built-in Local Drive. Triggers
   *  `drive.document.added` (or edited if the path already existed). */
  async driveWriteText(relPath: string, content: string) {
    try {
      const entry = await invoke('drive_write_text', { relPath, content });
      return { success: true, entry };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  /** Read a text document from Local Drive (for asserting translated output). */
  async driveReadText(relPath: string) {
    try {
      const content = await invoke<string>('drive_read_text', { relPath });
      return { success: true, content };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  /** List a folder's entries (smoke-check the drive before/after writes). */
  async driveList(relPath: string = '') {
    try {
      const entries = await invoke<unknown[]>('drive_list', { relPath });
      return { success: true, count: (entries as unknown[]).length, entries };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  /** Poll list_executions for a persona until a row appears at/after
   *  `sinceIso` with a terminal status. Returns the most recent execution. */
  async waitForPersonaExecution(personaId: string, sinceIso: string, timeoutMs: number = 180_000) {
    const sinceMs = Date.parse(sinceIso);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
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
    return { success: false, error: `No execution for persona ${personaId} within ${timeoutMs}ms` };
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
(window as unknown as Record<string, unknown>).__OVERVIEW_STORE__ = useOverviewStore;
(window as unknown as Record<string, unknown>).__VAULT_STORE__ = useVaultStore;
console.log("[test-automation] Bridge loaded — window.__TEST__ ready");

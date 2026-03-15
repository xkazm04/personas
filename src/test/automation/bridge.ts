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
      buildOutputLineCount: agent.buildOutputLines.length,
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

  /** Simulate build state for testing (sets Zustand store directly) */
  simulateBuild(phase: string, personaId: string, cells: Record<string, string>) {
    useAgentStore.setState({
      buildPhase: phase as never,
      buildPersonaId: personaId,
      buildCellStates: cells as never,
      buildSessionId: "test-session-sim",
    });
    if (phase === "analyzing" || phase === "resolving") {
      useSystemStore.getState().setIsCreatingPersona(true);
    }
    return { success: true, phase, personaId };
  },

  /** Navigate to settings and switch to a specific tab */
  openSettingsTab(tab: string) {
    useSystemStore.getState().setSidebarSection("settings");
    useSystemStore.getState().setSettingsTab(tab as never);
    return { success: true, tab };
  },

  /**
   * Dispatcher called from Rust via eval().
   * Executes a bridge method and sends the result back via Tauri IPC.
   */
  async __exec__(id: string, method: string, params: Record<string, unknown>) {
    try {
      const fn = (this as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") throw new Error(`Unknown method: ${method}`);
      const args = Object.values(params);
      const result = await fn.apply(this, args);
      await invoke("__test_respond", { id, result: JSON.stringify(result) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await invoke("__test_respond", { id, result: JSON.stringify({ error: msg }) });
    }
  },
};

// Expose on window for Rust eval() access
(window as unknown as Record<string, unknown>).__TEST__ = bridge;
console.log("[test-automation] Bridge loaded — window.__TEST__ ready");

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { setLoadedEnglishSection } from "@/i18n/englishSections";
import enAgents from "@/i18n/section-locales/en/agents.json";
import enOverview from "@/i18n/section-locales/en/overview.json";
import enVault from "@/i18n/section-locales/en/vault.json";

// `agents`, `overview` and `vault` left the eager English core on 2026-10-25
// (305 KB off the startup path). In the app a route preloads them before its
// surface mounts and the idle background load lands the rest within a second;
// a spec has neither, and one that rendered their copy synchronously passed or
// failed on whether that idle load happened to win (CostBreakdownBar, CI run
// 40191178765). Seeding them here gives every spec what it had before the
// change. Seeded through englishSections, not useTranslation, which many specs
// replace with vi.mock.
setLoadedEnglishSection("agents", enAgents);
setLoadedEnglishSection("overview", enOverview);
setLoadedEnglishSection("vault", enVault);

// Mock @tauri-apps/api/core -- all invoke() calls return undefined by default
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock @tauri-apps/api/event -- listen() returns a no-op unlisten function
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// jsdom returns 0 for layout queries used by @tanstack/react-virtual, which
// causes virtualized lists (e.g. TerminalBody) to render nothing in tests.
// Pretend every element is 800x600 with full layout so the virtualizer reports
// a non-empty viewport and renders all items present in its overscan window.
//
// Guarded: a pure-logic test opts out of jsdom with a first-line
// `// @vitest-environment node` (jsdom setup was ~0.5 s per file, 2026-10-25),
// and there is no HTMLElement to patch there.
if (typeof HTMLElement !== "undefined") {
  for (const [prop, value] of [
    ["clientHeight", 600],
    ["clientWidth", 800],
    ["scrollHeight", 600],
    ["offsetHeight", 600],
    ["offsetWidth", 800],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }
}

if (!("ResizeObserver" in globalThis)) {
  class MockResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver;
}

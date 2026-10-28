import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { setLoadedEnglishSection } from "@/i18n/englishSections";
import enAgents from "@/i18n/section-locales/en/agents.json";
import enOverview from "@/i18n/section-locales/en/overview.json";
import enVault from "@/i18n/section-locales/en/vault.json";
import enOnboarding from "@/i18n/section-locales/en/onboarding.json";
import enDecisionCenter from "@/i18n/section-locales/en/decisionCenter.json";
import enDeliberation from "@/i18n/section-locales/en/deliberation.json";
import enMonitor from "@/i18n/section-locales/en/monitor.json";
import enAthena from "@/i18n/section-locales/en/athena.json";
import enDebt from "@/i18n/section-locales/en/debt.json";
import enShared from "@/i18n/section-locales/en/shared.json";
import enNotepad from "@/i18n/section-locales/en/notepad.json";

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
// `onboarding` left the eager core too (2026-10-25, later); same reasoning.
setLoadedEnglishSection("onboarding", enOnboarding);
// `decisionCenter` and `deliberation` moved to OVERLAY_SECTIONS (src/i18n/routeSections.ts) the
// same day: the app fetches them when their overlay opens; a spec renders that overlay directly.
setLoadedEnglishSection("decisionCenter", enDecisionCenter);
setLoadedEnglishSection("deliberation", enDeliberation);
// The partial-core sections (FIRST_PAINT_PARTIAL_SECTIONS) were whole and eager before; a
// spec gets the full section, as the app has it a second after boot.
setLoadedEnglishSection("monitor", enMonitor);
setLoadedEnglishSection("athena", enAthena);
setLoadedEnglishSection("debt", enDebt);
setLoadedEnglishSection("shared", enShared);
setLoadedEnglishSection("notepad", enNotepad);

// Startup chrome renders framer-motion's light `m.*` components, and App.tsx's <LazyMotion>
// loads the animation features after first paint. A spec renders components without App, so
// `m.*` there would have no features at all (no exit fades, no animation callbacks). Give
// specs the full `motion` component under that name: what the app has once LazyMotion loads.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, m: actual.motion };
});

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

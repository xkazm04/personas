import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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

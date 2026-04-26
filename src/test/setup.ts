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
Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() { return 600; },
});
Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get() { return 800; },
});
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get() { return 600; },
});
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() { return 600; },
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get() { return 800; },
});

if (!("ResizeObserver" in globalThis)) {
  class MockResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver;
}

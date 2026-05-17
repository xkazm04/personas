import { describe, it, expect, beforeAll } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScrollShadows } from "../useScrollShadows";

// jsdom has no real layout engine — clientHeight / scrollHeight default
// to 0. We Object.defineProperty them on the underlying element so the
// hook's geometry checks have something to read.
function defineGeom(
  el: HTMLElement,
  { scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {},
) {
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: () => {
      // noop — tests drive scrollTop via re-define instead.
    },
  });
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
}

class StubResizeObserver {
  observe() {
    // noop — tests trigger updates via scroll events.
  }
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  // jsdom doesn't implement ResizeObserver. Provide a stub so the hook
  // can call new ResizeObserver(...) without throwing.
  (globalThis as Record<string, unknown>).ResizeObserver = StubResizeObserver;
});

describe("useScrollShadows", () => {
  it("starts with both shadows false until the ref is attached", () => {
    const { result } = renderHook(() => useScrollShadows<HTMLDivElement>());
    expect(result.current.topShadow).toBe(false);
    expect(result.current.bottomShadow).toBe(false);
  });

  it("computes bottomShadow=true when content overflows below viewport", () => {
    const el = document.createElement("div");
    defineGeom(el, { scrollTop: 0, scrollHeight: 500, clientHeight: 100 });
    document.body.appendChild(el);

    const { result } = renderHook(() => useScrollShadows<HTMLDivElement>());
    act(() => {
      result.current.ref.current = el;
    });
    // Re-run effect by simulating mount with the ref now set. We achieve
    // this by dispatching a scroll event after manually firing the
    // effect — the cleanest way without a re-render is to rerender the
    // hook with the same call.
    const { result: result2 } = renderHook(() => {
      const r = useScrollShadows<HTMLDivElement>();
      // Attach the same DOM node so the effect can read geometry.
      if (r.ref.current !== el) {
        (r.ref as { current: HTMLElement }).current = el;
      }
      return r;
    });
    // After the effect runs once, the initial geometry read should report
    // overflow below the viewport.
    expect(result2.current.bottomShadow).toBe(true);
    expect(result2.current.topShadow).toBe(false);

    document.body.removeChild(el);
  });

  it("computes topShadow=true after the user has scrolled past the top", () => {
    const el = document.createElement("div");
    defineGeom(el, { scrollTop: 50, scrollHeight: 500, clientHeight: 100 });
    document.body.appendChild(el);

    const { result } = renderHook(() => {
      const r = useScrollShadows<HTMLDivElement>();
      if (r.ref.current !== el) {
        (r.ref as { current: HTMLElement }).current = el;
      }
      return r;
    });

    expect(result.current.topShadow).toBe(true);
    expect(result.current.bottomShadow).toBe(true);

    document.body.removeChild(el);
  });

  it("computes both shadows false when content fits viewport", () => {
    const el = document.createElement("div");
    defineGeom(el, { scrollTop: 0, scrollHeight: 100, clientHeight: 100 });
    document.body.appendChild(el);

    const { result } = renderHook(() => {
      const r = useScrollShadows<HTMLDivElement>();
      if (r.ref.current !== el) {
        (r.ref as { current: HTMLElement }).current = el;
      }
      return r;
    });

    expect(result.current.topShadow).toBe(false);
    expect(result.current.bottomShadow).toBe(false);

    document.body.removeChild(el);
  });
});

"use client";
import { useEffect } from "react";

// Dev-only bridge for Athena Studio, written into every Studio project as
// app/_athena-preview-agent.tsx (webbuild::preview_agent). The host talks to it
// over postMessage:
//   {source:"athena", type:"locate", selector, reqId} -> "located" with the rect
//   {source:"athena", type:"inspect", on}             -> enter / leave inspect mode
//   {source:"athena", type:"inspect-move", dir}       -> out | in | prev | next
// and it reports on its own:
//   "route"   - the live path, on every client navigation
//   "inspect" - inspect mode turned on or off (Esc here, or a right-click)
//   "picked"  - the element chosen (right-click, or a click while inspecting),
//               again after every move and scroll: a selector that finds it,
//               a label a person recognises, the component frames around it,
//               its rect in this frame's viewport, and the path it is on.
//
// Inspect mode draws the frames INSIDE the page, so they follow scrolling: the
// target (solid), the React components that wrap it (dashed, named), and its
// children (dotted). Hover moves the target; a click or right-click chooses it;
// [ and ] (or the up and down arrows) move out to the wrapper and in to the
// child, left and right move to siblings, Esc leaves.
type Rect = { x: number; y: number; width: number; height: number };
type Dir = "out" | "in" | "prev" | "next";

const TEAL = "#2dd4bf";

/** A selector that finds `el` again: its id, else a nth-of-type path. */
export function selectorFor(el: Element): string {
  const esc = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s);
  if (el.id) return `#${esc(el.id)}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && parts.length < 8) {
    if (cur.id) {
      parts.unshift(`#${esc(cur.id)}`);
      break;
    }
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    const same = parent ? Array.from(parent.children).filter((c) => c.tagName === cur!.tagName) : [];
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
    cur = parent;
  }
  return parts.join(" > ") || el.tagName.toLowerCase();
}

/** What a person would call the element: its label, alt text or visible text. */
export function labelFor(el: Element): string {
  const raw =
    el.getAttribute("aria-label") ||
    el.getAttribute("alt") ||
    el.getAttribute("title") ||
    (el as HTMLElement).innerText ||
    el.textContent ||
    "";
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

// Framework components that wrap everything and name nothing the owner wrote.
const FRAMEWORK =
  /Boundary|Router|Redirect|NotFound|Provider|Consumer|Context|Suspense|Template|ScrollAndFocus|HotReload|DevOverlay|DevRoot|ServerRoot|^Inner|^Outer|^Html$|^Head$|^Body$|^AthenaPreviewAgent$/;

type Fiber = { type?: unknown; return?: Fiber | null };
const fiberName = (t: unknown): string | null => {
  if (typeof t === "function") return (t as { displayName?: string; name?: string }).displayName || t.name || null;
  if (t && typeof t === "object") {
    const o = t as { displayName?: string; render?: { displayName?: string; name?: string }; type?: unknown };
    return o.displayName || o.render?.displayName || o.render?.name || fiberName(o.type);
  }
  return null;
};

/**
 * The owner's component whose outermost element is `el`, read from React's
 * dev fiber: walk up from the element's fiber until the next host element (then
 * `el` sits inside someone else's markup) or a named component (then `el` is
 * that component's frame). Null in production or outside React.
 */
export function componentOf(el: Element): string | null {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  let f = ((el as unknown as Record<string, Fiber>)[key] ?? null)?.return ?? null;
  while (f) {
    if (typeof f.type === "string") return null;
    const name = fiberName(f.type);
    if (name && /^[A-Z]/.test(name) && !FRAMEWORK.test(name)) return name;
    f = f.return ?? null;
  }
  return null;
}

const area = (r: DOMRect) => r.width * r.height;
const sameBox = (a: Element, b: Element) => {
  const x = a.getBoundingClientRect();
  const y = b.getBoundingClientRect();
  return area(x) > 0 && x.x === y.x && x.y === y.y && x.width === y.width && x.height === y.height;
};
const inPage = (el: Element | null): el is Element =>
  !!el && el !== document.body && el !== document.documentElement && el.id !== "__athena-inspect";

/** One step through the page: out to the wrapper, in to the child, or to a sibling. */
export function step(el: Element, dir: Dir): Element {
  if (dir === "out") {
    let p = el.parentElement;
    // A wrapper with exactly the same box is not a step anyone can see.
    while (inPage(p) && sameBox(p, el) && inPage(p.parentElement)) p = p.parentElement;
    return inPage(p) ? p : el;
  }
  if (dir === "in") {
    let c = el.firstElementChild;
    while (c && sameBox(c, el) && c.firstElementChild) c = c.firstElementChild;
    return c ?? el;
  }
  const s = dir === "prev" ? el.previousElementSibling : el.nextElementSibling;
  return s ?? el;
}

/** The named frames around `el`, outermost first (at most four), then `el`. */
export function frameChain(el: Element): { el: Element; name: string }[] {
  const frames: { el: Element; name: string }[] = [];
  let cur = el.parentElement;
  while (inPage(cur) && frames.length < 3) {
    const name = componentOf(cur);
    if (name) frames.unshift({ el: cur, name });
    cur = cur.parentElement;
  }
  frames.push({ el, name: componentOf(el) ?? el.tagName.toLowerCase() });
  return frames;
}

export function AthenaPreviewAgent() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let ring: HTMLDivElement | null = null;
    let inspecting = false;
    let locked = false;
    let current: Element | null = null;
    let raf = 0;
    const layer = document.createElement("div");
    layer.id = "__athena-inspect";
    Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483646" });

    const post = (msg: Record<string, unknown>) => window.parent?.postMessage({ source: "athena-agent", ...msg }, "*");
    const clear = () => {
      if (ring) {
        ring.remove();
        ring = null;
      }
    };
    const highlight = (r: DOMRect, ms = 2600) => {
      clear();
      ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "fixed",
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        border: `2px solid ${TEAL}`,
        borderRadius: "8px",
        boxShadow: "0 0 0 4px rgba(45,212,191,0.25)",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.body.appendChild(ring);
      if (ms > 0) window.setTimeout(clear, ms);
    };

    const box = (r: DOMRect, style: string, label?: string, strong = false) => {
      const b = document.createElement("div");
      Object.assign(b.style, {
        position: "fixed",
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        border: style,
        borderRadius: "4px",
        background: strong ? "rgba(45,212,191,0.08)" : "transparent",
      });
      if (label) {
        const tag = document.createElement("span");
        tag.textContent = label;
        Object.assign(tag.style, {
          position: "absolute",
          left: "-2px",
          top: r.y > 22 ? "-22px" : "0",
          font: "600 11px/18px ui-sans-serif, system-ui, sans-serif",
          padding: "0 6px",
          borderRadius: "4px",
          whiteSpace: "nowrap",
          color: strong ? "#042f2e" : "#ccfbf1",
          background: strong ? TEAL : "rgba(4,47,46,0.85)",
        });
        b.appendChild(tag);
      }
      layer.appendChild(b);
    };
    const draw = () => {
      layer.replaceChildren();
      if (!inspecting || !current) return;
      const chain = frameChain(current);
      for (const f of chain.slice(0, -1)) box(f.el.getBoundingClientRect(), `1px dashed ${TEAL}`, f.name);
      for (const c of Array.from(current.children).slice(0, 12)) {
        const r = c.getBoundingClientRect();
        if (area(r) > 0) box(r, "1px dotted rgba(45,212,191,0.55)");
      }
      const r = current.getBoundingClientRect();
      const name = chain[chain.length - 1]!.name;
      box(r, `2px solid ${TEAL}`, `${name} · ${Math.round(r.width)}×${Math.round(r.height)}`, true);
    };
    const redraw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        draw();
        if (locked && current) report(current);
      });
    };

    const report = (el: Element) => {
      const r = el.getBoundingClientRect();
      post({
        type: "picked",
        selector: selectorFor(el),
        label: labelFor(el),
        tag: el.tagName.toLowerCase(),
        component: componentOf(el),
        chain: frameChain(el).map((f) => f.name),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        path: location.pathname + location.search,
      });
    };
    const setInspecting = (on: boolean, tell = true) => {
      inspecting = on;
      if (!on) {
        locked = false;
        current = null;
        layer.remove();
      } else if (!layer.isConnected) {
        document.body.appendChild(layer);
      }
      document.documentElement.style.cursor = on && !locked ? "crosshair" : "";
      draw();
      if (tell) post({ type: "inspect", on });
    };
    const choose = (el: Element) => {
      if (!inspecting) setInspecting(true);
      current = el;
      locked = true;
      document.documentElement.style.cursor = "";
      draw();
      report(el);
    };
    const move = (dir: Dir) => {
      if (!inspecting || !current) return;
      current = step(current, dir);
      draw();
      if (locked) report(current);
    };

    const isPage = (t: EventTarget | null): t is Element => t instanceof Element && !layer.contains(t);
    const onContextMenu = (e: MouseEvent) => {
      if (!isPage(e.target)) return;
      e.preventDefault();
      choose(e.target);
    };
    const onClick = (e: MouseEvent) => {
      if (!inspecting || !isPage(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      choose(e.target);
    };
    const onHover = (e: MouseEvent) => {
      if (!inspecting || locked || !isPage(e.target)) return;
      current = e.target;
      draw();
    };
    const KEYS: Record<string, Dir> = { "[": "out", ArrowUp: "out", "]": "in", ArrowDown: "in", ArrowLeft: "prev", ArrowRight: "next" };
    const onKey = (e: KeyboardEvent) => {
      if (!inspecting) return;
      if (e.key === "Escape") setInspecting(false);
      else if (KEYS[e.key]) move(KEYS[e.key]!);
      else if (e.key === "Enter" && current) choose(current);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };

    const onMsg = (e: MessageEvent) => {
      const d = e.data as
        | { source?: string; type?: string; selector?: string; reqId?: string; on?: boolean; dir?: Dir }
        | null;
      if (!d || d.source !== "athena") return;
      if (d.type === "inspect" || d.type === "pickmode") {
        setInspecting(!!d.on, false);
        return;
      }
      if (d.type === "inspect-move" && d.dir) {
        move(d.dir);
        return;
      }
      if (d.type !== "locate") return;
      let el: Element | null = null;
      try {
        el = d.selector ? document.querySelector(d.selector) : null;
      } catch {
        el = null;
      }
      const send = (rect: Rect | null, found: boolean) =>
        post({ type: "located", reqId: d.reqId, selector: d.selector, found, rect });
      if (!el) {
        send(null, false);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        const r = (el as Element).getBoundingClientRect();
        highlight(r);
        send({ x: r.x, y: r.y, width: r.width, height: r.height }, true);
      }, 350);
    };
    // Route reporting (A4) — post the live path to Studio so the preview toolbar
    // reflects navigation for ANY client router (Next app/pages, React Router):
    // they all go through the History API, so hooking it + popstate covers them.
    const reportRoute = () => post({ type: "route", path: location.pathname + location.search });
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
      origPush.apply(this, args);
      reportRoute();
    };
    history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
      origReplace.apply(this, args);
      reportRoute();
    };
    window.addEventListener("popstate", reportRoute);
    reportRoute();

    window.addEventListener("message", onMsg);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("mouseover", onHover, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", redraw, true);
    window.addEventListener("resize", redraw);
    return () => {
      window.removeEventListener("message", onMsg);
      window.removeEventListener("popstate", reportRoute);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("mouseover", onHover, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", redraw, true);
      window.removeEventListener("resize", redraw);
      cancelAnimationFrame(raf);
      history.pushState = origPush;
      history.replaceState = origReplace;
      document.documentElement.style.cursor = "";
      layer.remove();
      clear();
    };
  }, []);
  return null;
}

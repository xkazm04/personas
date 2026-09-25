"use client";
import { useEffect } from "react";

// Dev-only bridge for Athena Studio, written into every Studio project as
// app/_athena-preview-agent.tsx (webbuild::preview_agent). The host talks to it
// over postMessage:
//   {source:"athena", type:"locate", selector, reqId} -> "located" with the rect
//   {source:"athena", type:"pickmode", on}            -> the next click picks
// and it reports on its own:
//   "route"  - the live path, on every client navigation
//   "picked" - the element the user right-clicked (or clicked in pick mode):
//              a selector that finds it again, a label a person recognises,
//              its rect in this frame's viewport, and the path it is on.
type Rect = { x: number; y: number; width: number; height: number };

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

export function AthenaPreviewAgent() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let ring: HTMLDivElement | null = null;
    let picking = false;
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
        border: "2px solid #2dd4bf",
        borderRadius: "8px",
        boxShadow: "0 0 0 4px rgba(45,212,191,0.25)",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.body.appendChild(ring);
      if (ms > 0) window.setTimeout(clear, ms);
    };
    const post = (msg: Record<string, unknown>) => window.parent?.postMessage({ source: "athena-agent", ...msg }, "*");

    const pick = (el: Element) => {
      const r = el.getBoundingClientRect();
      highlight(r);
      post({
        type: "picked",
        selector: selectorFor(el),
        label: labelFor(el),
        tag: el.tagName.toLowerCase(),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        path: location.pathname + location.search,
      });
    };
    const setPicking = (on: boolean) => {
      picking = on;
      document.documentElement.style.cursor = on ? "crosshair" : "";
      if (!on) clear();
      post({ type: "pickmode", on });
    };
    const onContextMenu = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      e.preventDefault();
      pick(e.target);
    };
    const onClick = (e: MouseEvent) => {
      if (!picking || !(e.target instanceof Element)) return;
      e.preventDefault();
      e.stopPropagation();
      setPicking(false);
      pick(e.target);
    };
    const onHover = (e: MouseEvent) => {
      if (picking && e.target instanceof Element) highlight(e.target.getBoundingClientRect(), 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (picking && e.key === "Escape") setPicking(false);
    };

    const onMsg = (e: MessageEvent) => {
      const d = e.data as
        | { source?: string; type?: string; selector?: string; reqId?: string; on?: boolean }
        | null;
      if (!d || d.source !== "athena") return;
      if (d.type === "pickmode") {
        setPicking(!!d.on);
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
    return () => {
      window.removeEventListener("message", onMsg);
      window.removeEventListener("popstate", reportRoute);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("mouseover", onHover, true);
      window.removeEventListener("keydown", onKey, true);
      history.pushState = origPush;
      history.replaceState = origReplace;
      document.documentElement.style.cursor = "";
      clear();
    };
  }, []);
  return null;
}

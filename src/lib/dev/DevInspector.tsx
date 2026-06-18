/**
 * DevInspector — a dev-only "click a component, copy its source path" overlay.
 *
 * Armed from the `;` keyboard "special mode": press `;` to enter nav mode, then
 * `i` (Inspect) to arm/disarm. While armed, hover highlights the element under
 * the cursor and RIGHT-clicking copies a Claude-Code-friendly
 * `src/.../File.tsx:LINE` to the clipboard — left-click is left untouched so the
 * developer can keep operating the app while armed. Default copy = the call site
 * (the feature/page file that used the component); Alt+right-click copies the
 * literal element (often a shared-component internal); the breadcrumb HUD lets
 * you copy any enclosing file directly.
 *
 * Relies on the `inject-source-loc` Babel plugin (wired dev-only in
 * vite.config.ts) which stamps host elements with `data-loc`. Mounted only
 * behind `import.meta.env.DEV` in App.tsx, so it is absent from production.
 * Presentational chrome lives in `devInspectorUi.tsx`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { copyText } from "@/hooks/utility/interaction/useCopyToClipboard";
import { useAppKeyboard } from "@/lib/keyboard/AppKeyboardProvider";
import { isTypingTarget } from "@/lib/keyboard/KeyboardNavMode";
import { useSystemStore } from "@/stores/systemStore";
import { buildChain, dedupeChain, pickDefaultIndex, type LocEntry } from "./devLocate";
import { HighlightBox, InspectorHud, SourceLabel, Z } from "./devInspectorUi";

interface HoverState {
  chain: LocEntry[];
  pointerRect: DOMRect;
  targetRect: DOMRect;
  defaultIndex: number;
}

export function DevInspector() {
  const [armed, setArmed] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(true);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const navActive = useSystemStore((s) => s.keyboardNavActive);
  const setNavActive = useSystemStore((s) => s.setKeyboardNavActive);

  const doCopy = useCallback(async (loc: string) => {
    const ok = await copyText(loc);
    setCopyOk(ok);
    setCopied(loc);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1800);
  }, []);

  useAppKeyboard(
    (e) => {
      if (!import.meta.env.DEV) return false;
      // Enter via the `;` special mode (nav mode), then `i` (Inspect) to
      // arm/disarm. `i` is a free key inside nav mode (S/C/R/M/N/G are taken).
      if (
        navActive &&
        (e.key === "i" || e.key === "I") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (isTypingTarget(e.target)) return false;
        e.preventDefault();
        setNavActive(false); // leave nav mode; the inspector takes over
        setArmed((a) => !a);
        return true;
      }
      if (armed && e.key === "Escape") {
        setArmed(false);
        return true;
      }
      return false;
    },
    { priority: 1000 },
  );

  useEffect(() => {
    if (!armed) return;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "crosshair";

    const insideHud = (t: EventTarget | null) =>
      t instanceof Element && t.closest("[data-devinspector]") !== null;

    const onMove = (e: MouseEvent) => {
      if (insideHud(e.target)) return; // keep last highlight while over the HUD
      const chain = buildChain(e.target as Element | null);
      if (chain.length === 0 || !chain[0]) {
        setHover(null);
        return;
      }
      const di = pickDefaultIndex(chain);
      setHover({
        chain,
        pointerRect: chain[0].el.getBoundingClientRect(),
        targetRect: (chain[di] ?? chain[0]).el.getBoundingClientRect(),
        defaultIndex: di,
      });
    };

    // Right-click copies the source path under the cursor (and suppresses the
    // browser/app context menu). Left-click is deliberately NOT intercepted, so
    // the developer can keep operating the app while the inspector is armed —
    // hover still highlights what a right-click would copy.
    const onContextMenu = (e: MouseEvent) => {
      if (insideHud(e.target)) return; // let the HUD own its own context menu
      e.preventDefault();
      e.stopPropagation();
      const chain = buildChain(e.target as Element | null);
      if (chain.length === 0 || !chain[0]) return;
      const di = pickDefaultIndex(chain);
      const pick = e.altKey ? chain[0] : chain[di] ?? chain[0];
      void doCopy(pick.loc);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      document.body.style.cursor = prevCursor;
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      setHover(null);
    };
  }, [armed, doCopy]);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  if (!armed) return null;

  // When source mapping wasn't injected (a normal dev session), there are no
  // [data-loc] attributes to click — the HUD tells the user how to enable it.
  const mappingOn = document.querySelector("[data-loc]") !== null;
  const defaultLoc =
    hover && hover.chain[hover.defaultIndex]
      ? hover.chain[hover.defaultIndex]!.loc
      : null;
  const crumbs = hover ? dedupeChain(hover.chain) : [];

  return createPortal(
    <div
      data-devinspector
      style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none" }}
    >
      {hover && hover.defaultIndex !== 0 && (
        <HighlightBox rect={hover.pointerRect} variant="pointer" />
      )}
      {hover && <HighlightBox rect={hover.targetRect} variant="target" />}
      {hover && defaultLoc && <SourceLabel rect={hover.pointerRect} loc={defaultLoc} />}

      <InspectorHud
        copied={copied}
        copyOk={copyOk}
        mappingOn={mappingOn}
        crumbs={crumbs}
        defaultLoc={defaultLoc}
        onCopy={doCopy}
      />
    </div>,
    document.body,
  );
}

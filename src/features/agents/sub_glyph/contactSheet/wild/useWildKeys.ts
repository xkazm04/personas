/** useWildKeys: the sheet's keyboard paths.
 *  Esc pulls the camera back out of any layer. Alt+1..8 pushes into a frame.
 *  Enter runs the act's one primary action when focus is not already on a
 *  control that owns Enter (inputs, buttons). Promote-anyway is deliberately
 *  absent: it is never reachable by keyboard shortcut. Everything stands down
 *  while a real modal dialog (picker, report, codex) is open. */
import { useEffect } from "react";
import { GLYPH_DIMENSIONS, type GlyphDimension } from "@/features/shared/glyph";

interface WildKeys {
  layerOpen: boolean;
  onEscape: () => void;
  onFrame: (dim: GlyphDimension) => void;
  onEnter: (() => void) | null;
}

function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [aria-modal="true"]');
}

export function useWildKeys({ layerOpen, onEscape, onFrame, onEnter }: WildKeys) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || modalOpen()) return;
      if (e.key === "Escape" && layerOpen) {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const n = parseInt(e.key, 10);
        const dim = GLYPH_DIMENSIONS[n - 1];
        if (dim) { e.preventDefault(); onFrame(dim); }
        return;
      }
      if (e.key !== "Enter" || e.shiftKey || !onEnter) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A" || el?.isContentEditable) return;
      e.preventDefault();
      onEnter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layerOpen, onEscape, onFrame, onEnter]);
}

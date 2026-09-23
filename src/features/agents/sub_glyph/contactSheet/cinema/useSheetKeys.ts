/** useSheetKeys — the sheet-level keyboard. Escape pulls the camera back out
 *  of whatever layer it is in; Enter re-enters the question round or sends the
 *  reviewed answers. Inside a layer, the layer owns its own keys (number keys,
 *  Enter, Backspace in QuestionLayer); modals on top own theirs. */
import { useEffect, useRef } from "react";
import type { SheetAct } from "./sheetModel";
import type { useQuestionFlow } from "./useQuestionFlow";

interface Args {
  act: SheetAct;
  flow: ReturnType<typeof useQuestionFlow>;
  layer: unknown;
  confirm: unknown;
  closeLayer: () => void;
}

const interactive = (el: HTMLElement | null) =>
  !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON" || el.tagName === "SELECT" || el.isContentEditable);

export function useSheetKeys(args: Args) {
  const latest = useRef(args);
  latest.current = args;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { act, flow, layer, confirm, closeLayer } = latest.current;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (confirm || target?.closest('[aria-modal="true"]')) return;
      if (e.key === "Escape") {
        if (layer) { e.preventDefault(); closeLayer(); }
        else if (act === "questions" && flow.stage === "asking") { e.preventDefault(); flow.pullBack(); }
        return;
      }
      if (e.key !== "Enter" || e.shiftKey || layer || interactive(target) || act !== "questions") return;
      if (flow.stage === "away" || flow.stage === "intro") { e.preventDefault(); flow.open(); }
      else if (flow.stage === "review") { e.preventDefault(); flow.send(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

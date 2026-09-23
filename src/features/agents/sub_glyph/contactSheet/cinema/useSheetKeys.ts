/** useSheetKeys — the sheet-level keyboard. Escape pulls the camera back out
 *  of whatever layer it is in; Enter re-enters the question round or sends the
 *  reviewed answers. Inside a layer, the layer owns its own keys (number keys,
 *  Enter, Backspace in QuestionLayer); modals on top own theirs. */
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from "@/lib/keyboard/AppKeyboardProvider";
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

/** Registered on the app's keyboard ladder at the route rung, so a modal or a
 *  summoned layer above the build takes its keys first. Returns true only for a
 *  key it consumed. */
export function useSheetKeys(args: Args) {
  const { act, flow, layer, confirm, closeLayer } = args;
  useAppKeyboard((e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (confirm || target?.closest('[aria-modal="true"]')) return false;
    if (e.key === "Escape") {
      if (layer) { e.preventDefault(); closeLayer(); return true; }
      if (act === "questions" && flow.stage === "asking") { e.preventDefault(); flow.pullBack(); return true; }
      return false;
    }
    if (e.key !== "Enter" || e.shiftKey || layer || interactive(target) || act !== "questions") return false;
    if (flow.stage === "away" || flow.stage === "intro") { e.preventDefault(); flow.open(); return true; }
    if (flow.stage === "review") { e.preventDefault(); flow.send(); return true; }
    return false;
  }, { priority: ROUTE_DECISION_PRIORITY });
}

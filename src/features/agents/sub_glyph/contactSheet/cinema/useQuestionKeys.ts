/** useQuestionKeys - the keyboard of one asked question, shared by every
 *  layout that draws the question round (Cinema's QuestionLayer, the dial's
 *  DialQuestion). Number keys pick an option, Enter moves on, Backspace goes
 *  back; the first option takes focus once the layer has landed. On the app's
 *  keyboard ladder at the route rung, so a modal or a summoned layer above the
 *  build takes its keys first. */
import { useEffect, useRef } from "react";
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from "@/lib/keyboard/AppKeyboardProvider";
import type { BuildQuestion } from "@/lib/types/buildTypes";

interface Args {
  question: BuildQuestion;
  options: readonly string[];
  index: number;
  draft: string;
  onPick: (v: string) => void;
  onNext: () => void;
  onPrev: () => void;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

/** Returns the ref the first option should carry. */
export function useQuestionKeys({ question, options, index, draft, onPick, onNext, onPrev }: Args) {
  const firstOpt = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const h = window.setTimeout(() => firstOpt.current?.focus(), 260);
    return () => window.clearTimeout(h);
  }, [question]);

  useAppKeyboard((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return false;
    if (/^[1-9]$/.test(e.key)) {
      const opt = options[Number(e.key) - 1];
      if (opt === undefined) return false;
      e.preventDefault();
      onPick(opt);
      return true;
    }
    if (e.key === "Enter" && draft.trim() && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      onNext();
      return true;
    }
    if (e.key === "Backspace" && index > 0) {
      e.preventDefault();
      onPrev();
      return true;
    }
    return false;
  }, { priority: ROUTE_DECISION_PRIORITY });

  return firstOpt;
}

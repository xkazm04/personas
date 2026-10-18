import { useEffect, useRef } from "react";

/**
 * Run `onOpen` when a picker OPENS, and only then.
 *
 * The four composer pickers seed a local draft from their props when they
 * open. Keying that seed on the props themselves (`[open, selected, ...]`)
 * re-ran it on every parent render that handed in a new array - a caller's
 * `selected ?? []`, or a store refresh replacing `personas` - and silently
 * threw away whatever the operator had picked so far. `onOpen` reads the
 * latest props through a ref, so the seed is current without being a trigger.
 * Its return value is the effect cleanup (a focus timer, typically).
 */
export function useOnOpen(open: boolean, onOpen: () => void | (() => void)): void {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    if (!open) return;
    return onOpenRef.current() ?? undefined;
  }, [open]);
}

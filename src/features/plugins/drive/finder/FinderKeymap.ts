import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// One document-level keydown listener for the Finder. `resolveFinderKey` is
// the pure dispatch table (unit-tested); `useFinderKeymap` attaches the
// listener ONCE and routes through a ref so a fresh handler object every
// render never re-attaches it (the refs pattern from the classic page).
// ---------------------------------------------------------------------------

export type FinderAction =
  | "selectAll"
  | "focusSearch"
  | "editPath"
  | "recent1"
  | "recent2"
  | "recent3"
  | "recent4"
  | "recent5"
  | "copy"
  | "cut"
  | "paste"
  | "delete"
  | "rename"
  | "open"
  | "moveUp"
  | "moveDown"
  | "goUp"
  | "escape"
  | "quickLook"
  | "inspector"
  | "duplicate"
  | "newFolder"
  | "export"
  | "import";

/** Returning `false` means "nothing to act on" — the event is left alone. */
export type FinderKeyHandlers = Partial<Record<FinderAction, () => boolean | void>>;

export interface FinderKeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Show ⌘ on Mac, Ctrl elsewhere — the handler accepts both modifiers. */
export const MOD_KEY_LABEL =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

const MOD_SHIFT: Record<string, FinderAction> = { n: "newFolder", e: "export", i: "import" };
const MOD_PLAIN: Record<string, FinderAction> = {
  a: "selectAll",
  l: "editPath",
  f: "focusSearch",
  c: "copy",
  x: "cut",
  v: "paste",
  i: "inspector",
  d: "duplicate",
};
const BARE: Record<string, FinderAction> = {
  Delete: "delete",
  Backspace: "delete",
  F2: "rename",
  Enter: "open",
  ArrowUp: "moveUp",
  ArrowDown: "moveDown",
  ArrowLeft: "goUp",
  Escape: "escape",
  " ": "quickLook",
};

export function resolveFinderKey(e: FinderKeyLike): FinderAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey) return null;
  if (mod) {
    const k = e.key.toLowerCase();
    if (e.shiftKey) return MOD_SHIFT[k] ?? null;
    if (/^[1-5]$/.test(e.key)) return `recent${e.key as "1" | "2" | "3" | "4" | "5"}`;
    return MOD_PLAIN[k] ?? null;
  }
  if (e.shiftKey && e.key !== "Enter") return null;
  return BARE[e.key] ?? null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export function useFinderKeymap(handlers: FinderKeyHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const action = resolveFinderKey(e);
      if (!action) return;
      const fn = handlersRef.current[action];
      if (!fn) return;
      if (fn() === false) return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** useWildFocus: where the camera is pointed, and the question choreography.
 *
 *  `focus` is the inner layer the camera has pushed into (a frame, or one of
 *  the centre frame's pages). When questions are pending and nothing is open,
 *  the camera waits one beat (so the frame visibly turns safelight red) and
 *  then pushes into the first question's frame. Esc pulls out and suppresses
 *  that auto push until the set of pending questions changes. Answering pulls
 *  straight back out; the next question then gets its own push in. */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { CELL_KEY_TO_DIM } from "../../glyphLayoutHelpers";
import { FRAME_ORIGIN } from "./SheetFrame";
import type { Act } from "./useReel";

export type Focus =
  | { kind: "dim"; dim: GlyphDimension }
  | { kind: "ask" }
  | { kind: "notes" }
  | { kind: "refine" }
  | { kind: "prints" };

const PUSH_BEAT_MS = 650;

export function focusKey(f: Focus): string {
  return f.kind === "dim" ? `dim-${f.dim}` : f.kind;
}

export function useWildFocus(act: Act, sessionId: string | null, pending: BuildQuestion[]) {
  const [focus, setFocusRaw] = useState<Focus | null>(null);
  const [origin, setOrigin] = useState("50% 50%");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pendingKey = useMemo(() => pending.map((q) => `${q.cellKey}::${q.question}`).join("|"), [pending]);

  const open = useCallback((f: Focus | null) => {
    if (f) setOrigin(f.kind === "dim" ? FRAME_ORIGIN[f.dim] : "50% 50%");
    setFocusRaw(f);
  }, []);

  const close = useCallback(() => {
    if (act === "questions") setDismissed(pendingKey);
    setFocusRaw(null);
  }, [act, pendingKey]);

  // New session or new act: the camera starts back on the sheet.
  useEffect(() => { setFocusRaw(null); setDismissed(null); }, [sessionId]);
  useEffect(() => { setFocusRaw(null); }, [act]);

  // The push into the next question, one beat after it lands.
  useEffect(() => {
    if (act !== "questions" || focus || !pending[0] || dismissed === pendingKey) return;
    const first = pending[0];
    const h = window.setTimeout(() => {
      const dim = CELL_KEY_TO_DIM[first.cellKey];
      open(dim ? { kind: "dim", dim } : { kind: "ask" });
    }, PUSH_BEAT_MS);
    return () => window.clearTimeout(h);
  }, [act, focus, pending, pendingKey, dismissed, open]);

  /** The pending question for the open layer, if any. */
  const question = useMemo(() => {
    if (!focus) return null;
    if (focus.kind === "dim") return pending.find((q) => CELL_KEY_TO_DIM[q.cellKey] === focus.dim) ?? null;
    if (focus.kind === "ask") return pending.find((q) => !CELL_KEY_TO_DIM[q.cellKey]) ?? pending[0] ?? null;
    return null;
  }, [focus, pending]);

  const resume = useCallback(() => { setDismissed(null); }, []);

  return { focus, origin, open, close, question, resume };
}

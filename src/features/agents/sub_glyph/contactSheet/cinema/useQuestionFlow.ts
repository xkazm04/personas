/** useQuestionFlow — the question round as a camera script.
 *
 *  intro  -> the first pass lands; the centre announces the questions
 *  asking -> the camera is inside question `qi`'s frame
 *  away   -> the user pulled back out (Esc) mid-round
 *  review -> every question has a draft; the centre lists them with Send
 *  sending-> Send pressed; answers handed to the build one by one
 *
 *  Answers stay drafts on this sheet until Send, then each goes through the
 *  real `onAnswer(cellKey, answer)`; the container submits the round once the
 *  queue is empty. `qi` is clamped to the live queue on every read, so a fast
 *  hand or a shrinking queue can never ask "question 5 of 4". */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";

export type FlowStage = "intro" | "asking" | "away" | "review" | "sending";
const keyOf = (q: BuildQuestion) => `${q.cellKey}|${q.question}`;

export function useQuestionFlow(
  pendingQuestions: BuildQuestion[] | null,
  onAnswer: (cellKey: string, answer: string) => void,
) {
  const qs = useMemo(() => pendingQuestions ?? [], [pendingQuestions]);
  const signature = useMemo(() => qs.map(keyOf).join("␞"), [qs]);
  const [stage, setStage] = useState<FlowStage>("intro");
  const [rawQi, setQi] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const autoNext = useRef<number | null>(null);

  const clearAuto = () => {
    if (autoNext.current !== null) { window.clearTimeout(autoNext.current); autoNext.current = null; }
  };

  // A new batch of questions starts a fresh round.
  useEffect(() => {
    clearAuto();
    setQi(0);
    setStage("intro");
  }, [signature]);
  useEffect(() => clearAuto, []);

  const n = qs.length;
  const qi = n === 0 ? 0 : Math.min(Math.max(rawQi, 0), n - 1);
  const current = n ? qs[qi]! : null;
  const draftOf = useCallback((q: BuildQuestion) => drafts[keyOf(q)] ?? "", [drafts]);

  const setDraft = useCallback((q: BuildQuestion, v: string) => {
    setDrafts((d) => ({ ...d, [keyOf(q)]: v }));
  }, []);

  const next = useCallback(() => {
    clearAuto();
    if (!current || !(drafts[keyOf(current)] ?? "").trim()) return;
    if (qi < n - 1) setQi(qi + 1);
    else setStage("review");
  }, [current, drafts, qi, n]);

  const prev = useCallback(() => {
    clearAuto();
    if (qi > 0) setQi(qi - 1);
  }, [qi]);

  /** A picked option auto-advances after a short beat, so the choice is seen. */
  const pick = useCallback((v: string) => {
    if (!current) return;
    const key = keyOf(current);
    setDrafts((d) => ({ ...d, [key]: v }));
    clearAuto();
    const at = qi;
    autoNext.current = window.setTimeout(() => {
      autoNext.current = null;
      setQi((cur) => (cur === at && at < n - 1 ? at + 1 : cur));
      if (at >= n - 1) setStage((s) => (s === "asking" ? "review" : s));
    }, 260);
  }, [current, qi, n]);

  const open = useCallback((i = qi) => {
    clearAuto();
    setQi(Math.min(Math.max(i, 0), Math.max(0, n - 1)));
    setStage("asking");
  }, [qi, n]);

  const pullBack = useCallback(() => { clearAuto(); setStage((s) => (s === "asking" ? "away" : s)); }, []);

  const allDrafted = qs.length > 0 && qs.every((q) => (drafts[keyOf(q)] ?? "").trim());
  const send = useCallback(() => {
    if (!allDrafted || stage === "sending") return;
    setStage("sending");
    for (const q of qs) onAnswer(q.cellKey, (drafts[keyOf(q)] ?? "").trim());
  }, [allDrafted, stage, qs, drafts, onAnswer]);

  /** Frames develop with the drafts already given (the one being asked stays open). */
  const answeredByDim = useMemo(() => {
    const out: Partial<Record<GlyphDimension, string>> = {};
    qs.forEach((q, i) => {
      const d = CELL_KEY_TO_DIM[q.cellKey];
      const v = (drafts[keyOf(q)] ?? "").trim();
      if (d && v && !(stage === "asking" && i === qi)) out[d] = v;
    });
    return out;
  }, [qs, drafts, stage, qi]);

  return {
    qs, n, qi, current, stage, allDrafted, answeredByDim,
    draftOf, setDraft, next, prev, pick, open, pullBack, send,
  };
}

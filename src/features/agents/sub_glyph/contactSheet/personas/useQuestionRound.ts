/** useQuestionRound - local drafts for one round of clarifying questions.
 *
 *  `onAnswer` removes a question from the store's pending list, and the
 *  container auto-submits the batch once that list empties. So answers are
 *  held HERE until the user presses "Send answers"; only then is `onAnswer`
 *  called, once per cell key. Nothing leaves the sheet invisibly.
 *
 *  The index is always clamped to the live list, so answering fast (or the
 *  list shrinking under us) can never produce "Question 5 of 4". */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { CELL_KEY_TO_DIM } from "../../glyphLayoutHelpers";

export const qKey = (q: BuildQuestion) => `${q.cellKey}|${q.question}`;

export interface QuestionRound {
  questions: BuildQuestion[];
  index: number;
  current: BuildQuestion | null;
  drafts: Record<string, string>;
  answeredCount: number;
  allAnswered: boolean;
  sending: boolean;
  answeredByDim: Partial<Record<GlyphDimension, string>>;
  setIndex: (i: number) => void;
  setDraft: (q: BuildQuestion, v: string) => void;
  /** Next unanswered index after `from` (wrapping), or -1 when all are answered. */
  nextUnanswered: (from: number) => number;
  indexOfDim: (dim: GlyphDimension) => number;
  send: () => void;
}

export function useQuestionRound(
  pending: BuildQuestion[] | null,
  onAnswer: (cellKey: string, answer: string) => void,
  resetKey: string | null,
): QuestionRound {
  const questions = useMemo(() => pending ?? [], [pending]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rawIndex, setRawIndex] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => { setDrafts({}); setRawIndex(0); setSending(false); }, [resetKey]);
  useEffect(() => {
    if (questions.length === 0) { setSending(false); setDrafts({}); setRawIndex(0); }
  }, [questions.length]);

  const index = Math.min(Math.max(0, rawIndex), Math.max(0, questions.length - 1));
  const answered = (q: BuildQuestion) => !!drafts[qKey(q)]?.trim();
  const answeredCount = questions.filter(answered).length;

  const setIndex = useCallback((i: number) => setRawIndex(i), []);
  const setDraft = useCallback((q: BuildQuestion, v: string) => {
    setDrafts((d) => ({ ...d, [qKey(q)]: v }));
  }, []);

  const nextUnanswered = (from: number) => {
    for (let step = 1; step <= questions.length; step++) {
      const i = (from + step) % questions.length;
      if (!answered(questions[i]!)) return i;
    }
    return -1;
  };

  const indexOfDim = (dim: GlyphDimension) => questions.findIndex((q) => CELL_KEY_TO_DIM[q.cellKey] === dim);

  const answeredByDim = useMemo(() => {
    const out: Partial<Record<GlyphDimension, string>> = {};
    for (const q of questions) {
      const dim = CELL_KEY_TO_DIM[q.cellKey];
      const v = drafts[qKey(q)]?.trim();
      if (dim && v) out[dim] = v;
    }
    return out;
  }, [questions, drafts]);

  const send = () => {
    if (sending || questions.length === 0 || answeredCount !== questions.length) return;
    // Two questions on one cell key would overwrite each other in the store's
    // pendingAnswers map, so they travel as one joined answer.
    const byCell = new Map<string, string[]>();
    for (const q of questions) {
      const list = byCell.get(q.cellKey) ?? [];
      list.push(drafts[qKey(q)]!.trim());
      byCell.set(q.cellKey, list);
    }
    setSending(true);
    for (const [cellKey, list] of byCell) onAnswer(cellKey, list.join(" / "));
  };

  return {
    questions, index, current: questions[index] ?? null, drafts, answeredCount,
    allAnswered: questions.length > 0 && answeredCount === questions.length,
    sending, answeredByDim, setIndex, setDraft, nextUnanswered, indexOfDim, send,
  };
}

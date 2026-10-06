/**
 * The sheet's decision flow — one state machine for all four modal types, so
 * the keyboard, the footer buttons and the reason prompt drive the SAME acts:
 *
 *   idle --A--> commit accept            (council: arm, Enter confirms)
 *   idle --R--> arm reject --Enter--> commit, or open the reason prompt
 *   reason prompt --1..9--> commit with that reason, --Enter--> commit without
 *   any --Esc--> back one step (prompt -> armed -> idle -> modal closes)
 */
import { useCallback, useEffect, useState } from 'react';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import type { PrototypeVerdict } from '../../directionContract';

export type Leave = 'accept' | 'reject' | 'done' | 'reply' | 'skip';
export const COUNCIL_MIN_REASON = 12;

export interface SheetFlow {
  armed: 'accept' | 'reject' | null;
  reasonOpen: boolean;
  reason: string;
  answers: Record<string, string>;
  rating: number;
  reply: string;
  setReason: (s: string) => void;
  setAnswer: (key: string, value: string) => void;
  setRating: (n: number) => void;
  setReply: (s: string) => void;
  accept: () => void;
  reject: () => void;
  confirm: () => boolean;
  cancel: () => boolean;
  skip: () => void;
  done: () => void;
  branch: (index: number) => boolean;
  pickReason: (index: number) => boolean;
  submitReason: () => boolean;
  send: () => boolean;
}

/** The reason prompt for an item's reject — the same lookup as `reasonPromptFor`,
 *  over the wider DecisionItem (its `reasonPrompts` field is TriageItem's, unchanged). */
export function rejectPrompt(item: DecisionItem) {
  return item.reasonPrompts?.find((p) => p.on === 'reject');
}

export function useSheetFlow(
  item: DecisionItem | null,
  commit: (v: PrototypeVerdict, leave: Leave) => void,
  focusComposer: () => void,
): SheetFlow {
  const [armed, setArmed] = useState<'accept' | 'reject' | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [rating, setRating] = useState(0);
  const [reply, setReply] = useState('');

  const id = item?.id;
  useEffect(() => {
    setArmed(null); setReasonOpen(false); setReason(''); setAnswers({}); setRating(0); setReply('');
  }, [id]);

  const type = item ? modalTypeOf(item.kind) : null;
  const isCouncil = item?.kind === 'council';
  const isReport = item?.kind === 'report';

  const finishReject = useCallback((why?: string) => {
    if (!item) return;
    commit({ item, verdict: 'reject', reason: why || undefined }, 'reject');
  }, [item, commit]);

  const accept = useCallback(() => {
    if (!item) return;
    if (type === 'chat') { focusComposer(); return; }
    if (isReport) return;
    if (isCouncil) { setArmed('accept'); return; }
    commit({ item, verdict: 'accept' }, 'accept');
  }, [item, type, isReport, isCouncil, commit, focusComposer]);

  const reject = useCallback(() => {
    if (!item || type === 'chat' || isReport) return;
    if (isCouncil) { setArmed('reject'); setReasonOpen(true); return; }
    setArmed('reject');
  }, [item, type, isReport, isCouncil]);

  const submitReason = useCallback(() => {
    if (!item) return false;
    if (isCouncil && reason.trim().length < COUNCIL_MIN_REASON) return false;
    finishReject(reason.trim());
    return true;
  }, [item, isCouncil, reason, finishReject]);

  const confirm = useCallback(() => {
    if (!item) return false;
    if (reasonOpen) return submitReason();
    if (armed === 'accept') { commit({ item, verdict: 'accept' }, 'accept'); return true; }
    if (armed === 'reject') {
      if (rejectPrompt(item)) setReasonOpen(true);
      else finishReject();
      return true;
    }
    return false;
  }, [item, reasonOpen, armed, submitReason, commit, finishReject]);

  const cancel = useCallback(() => {
    if (reasonOpen || armed) { setReasonOpen(false); setArmed(null); setReason(''); return true; }
    return false;
  }, [reasonOpen, armed]);

  const pickReason = useCallback((index: number) => {
    if (!item || !reasonOpen) return false;
    const opt = rejectPrompt(item)?.options[index];
    if (!opt) return false;
    finishReject(opt.value);
    return true;
  }, [item, reasonOpen, finishReject]);

  const branch = useCallback((index: number) => {
    if (!item) return false;
    const b = item.branches[index];
    if (!b) return false;
    const verdict = isReport ? 'done' : 'accept';
    commit({ item, verdict, branchId: b.id }, verdict);
    return true;
  }, [item, isReport, commit]);

  const skip = useCallback(() => { if (item) commit({ item, verdict: 'skip' }, 'skip'); }, [item, commit]);

  const done = useCallback(() => {
    if (!item || !(isReport || type === 'chat')) return;
    commit({ item, verdict: 'done', reason: rating ? `rated ${rating}/5` : undefined }, 'done');
  }, [item, isReport, type, rating, commit]);

  const send = useCallback(() => {
    if (!item || !reply.trim()) return false;
    commit({ item, verdict: 'reply', text: reply.trim() }, 'reply');
    return true;
  }, [item, reply, commit]);

  const setAnswer = useCallback((key: string, value: string) => setAnswers((a) => ({ ...a, [key]: value })), []);

  return {
    armed, reasonOpen, reason, answers, rating, reply,
    setReason, setAnswer, setRating, setReply,
    accept, reject, confirm, cancel, skip, done, branch, pickReason, submitReason, send,
  };
}

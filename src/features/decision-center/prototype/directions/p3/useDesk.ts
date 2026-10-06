/**
 * The desk's controller: cursor, walk direction, the arm -> confirm -> reason
 * ladder, the verdict stamp, and the one `commit` every verdict goes through.
 * Components read it; `useDeskKeys` drives it from the keyboard.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TriageReasonPrompt } from '@/features/agents/quick-answer/triage/triageTypes';
import { modalTypeOf, type DecisionItem, type DecisionModalType } from '../../../model/decisionModel';
import type { PrototypeVerdict } from '../../directionContract';

export type Verdict = PrototypeVerdict['verdict'];
export type Exit = Verdict | 'walk';
export interface Stamp { key: number; label: string; tone: 'success' | 'error' | 'info' }

const STAMP_MS = 650;

export function reasonPromptOf(item: DecisionItem | undefined): TriageReasonPrompt | undefined {
  return item?.reasonPrompts?.find((p) => p.on === 'reject');
}

export function useDesk(queue: DecisionItem[], startIndex: number, onDecide: (v: PrototypeVerdict) => void) {
  const [index, setIndex] = useState(startIndex);
  const [dir, setDir] = useState<1 | -1>(1);
  const [exit, setExit] = useState<Exit>('walk');
  const [armed, setArmed] = useState<'accept' | 'reject' | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [decided, setDecided] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const at = Math.min(index, Math.max(0, queue.length - 1));
  const item: DecisionItem | undefined = queue[at];
  const type: DecisionModalType | null = item ? modalTypeOf(item.kind) : null;

  useEffect(() => { if (index !== at) setIndex(at); }, [index, at]);
  useEffect(() => {
    if (!stamp) return;
    const t = setTimeout(() => setStamp(null), STAMP_MS);
    return () => clearTimeout(t);
  }, [stamp]);

  const resetLocal = useCallback(() => {
    setArmed(null); setReasonOpen(false); setReasonText(''); setRating(null); setAnswers({});
  }, []);

  const walk = useCallback((d: 1 | -1) => {
    const next = at + d;
    if (next < 0 || next >= queue.length) return;
    setDir(d); setExit('walk'); setIndex(next); resetLocal();
  }, [at, queue.length, resetLocal]);

  const jump = useCallback((i: number) => {
    if (i === at || i < 0 || i >= queue.length) return;
    setDir(i > at ? 1 : -1); setExit('walk'); setIndex(i); resetLocal();
  }, [at, queue.length, resetLocal]);

  const commit = useCallback((v: Omit<PrototypeVerdict, 'item'>, label: string) => {
    if (!item) return;
    const tone = v.verdict === 'reject' ? 'error' : v.verdict === 'accept' || v.verdict === 'reply' ? 'success' : 'info';
    setStamp({ key: Date.now(), label, tone });
    setExit(v.verdict); setDir(1); resetLocal();
    if (v.verdict === 'skip') {
      onDecide({ item, ...v });
      if (at + 1 < queue.length) setIndex(at + 1);
      return;
    }
    setDecided((n) => n + 1);
    onDecide({ item, ...v });
  }, [item, at, queue.length, onDecide, resetLocal]);

  const accept = useCallback((force = false) => {
    if (!item || type === 'chat') return;
    if (item.kind === 'report') return;
    if (item.kind === 'council' && !force && armed !== 'accept') { setArmed('accept'); return; }
    const text = item.input ? JSON.stringify(answers) : undefined;
    commit({ verdict: 'accept', text }, item.verdictLabels.accept);
  }, [item, type, armed, answers, commit]);

  const reject = useCallback(() => {
    if (!item || type === 'chat' || item.kind === 'report') return;
    setArmed('reject');
  }, [item, type]);

  const sendReject = useCallback((reason?: string) => {
    if (!item) return;
    commit({ verdict: 'reject', reason }, item.verdictLabels.reject);
  }, [item, commit]);

  const confirm = useCallback(() => {
    if (armed === 'accept') { accept(true); return; }
    if (armed !== 'reject') return;
    if (reasonPromptOf(item)) { setReasonOpen(true); return; }
    sendReject();
  }, [armed, item, accept, sendReject]);

  const cancel = useCallback(() => { setArmed(null); setReasonOpen(false); setReasonText(''); }, []);

  const pickReason = useCallback((i: number) => {
    const opt = reasonPromptOf(item)?.options[i];
    if (opt) sendReject(opt.value);
  }, [item, sendReject]);

  /** Council's send-back is the one reject that cannot go without a reason. */
  const reasonRequired = item?.kind === 'council';
  const skipReason = useCallback(() => {
    if (reasonRequired) cancel(); else sendReject();
  }, [reasonRequired, cancel, sendReject]);
  const submitReason = useCallback(() => {
    if (reasonRequired && reasonText.trim().length < 12) return;
    sendReject(reasonText.trim() || undefined);
  }, [reasonRequired, reasonText, sendReject]);

  const branch = useCallback((i: number) => {
    const b = item?.branches[i];
    if (b) commit({ verdict: 'accept', branchId: b.id }, b.label);
  }, [item, commit]);

  const done = useCallback(() => {
    if (type !== 'report' && type !== 'chat') return;
    if (item?.kind === 'council') return;
    commit({ verdict: 'done', reason: rating ? `rating:${rating}` : undefined }, type === 'chat' ? 'Done' : 'Read');
  }, [type, item, rating, commit]);

  const reply = useCallback((text: string) => {
    if (!text.trim()) return;
    commit({ verdict: 'reply', text: text.trim() }, 'Sent');
  }, [commit]);

  const skip = useCallback(() => commit({ verdict: 'skip' }, 'Later'), [commit]);

  return {
    item, type, index: at, total: queue.length, dir, exit, armed, reasonOpen, reasonText, reasonRequired,
    rating, answers, stamp, decided, bodyRef, composerRef,
    walk, jump, accept, reject, confirm, cancel, pickReason, skipReason, submitReason, branch, done, reply, skip,
    setReasonText, setRating, setAnswer: (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v })),
  };
}

export type DeskCtl = ReturnType<typeof useDesk>;

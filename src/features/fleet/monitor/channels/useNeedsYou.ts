import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { TriageReasonPrompt } from '@/features/agents/quick-answer/triage/triageTypes';
import type { Ask } from './needsYouModel';
import type { PendingAsks } from './usePendingAsks';

/* ----------------------------------------------------------------------------
 * THE NEEDS YOU CONTROLLER - which ask is in hand and what each verb does.
 *
 * The deck's grammar, scoped to one rail: A accepts (approve, or opens the
 * answer field on a question), R rejects (a review asks "Why?" first, Enter
 * with nothing typed sends no reason; a question is skipped), S leaves it for
 * later (the next ask comes into hand), J / K walk, 1-9 take a branch (a
 * suggested action, an option, Open in builder). The ask in hand is kept by
 * id, so a poll that reorders the queue never swaps it under the operator.
 * -------------------------------------------------------------------------- */

export type NeedsYou = ReturnType<typeof useNeedsYou>;

/** Deep-link to a persona's builder (a question the rail cannot answer inline). */
function openBuilder(personaId: string) {
  const system = useSystemStore.getState();
  system.setSidebarSection('personas');
  system.setEditorTab('matrix');
  useAgentStore.getState().selectPersona(personaId);
}

export function useNeedsYou(asks: readonly Ask[], writes: PendingAsks) {
  const { t } = useTranslation();
  const m = t.monitor;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<TriageReasonPrompt | null>(null);

  const index = Math.max(0, asks.findIndex((a) => a.id === focusId));
  const ask: Ask | null = asks[index] ?? null;
  // The ask in hand left the queue (decided, or decided elsewhere): the next one takes its place.
  useEffect(() => {
    if (ask && ask.id !== focusId) setFocusId(ask.id);
  }, [ask, focusId]);
  const askId = ask?.id;
  useEffect(() => setPrompt(null), [askId]);

  const walk = useCallback((d: 1 | -1) => {
    if (asks.length === 0) return;
    setFocusId(asks[(index + d + asks.length) % asks.length]!.id);
  }, [asks, index]);
  /** Decided: the ask after it comes into hand (by id, before the write lands). */
  const advance = useCallback(() => {
    const next = asks[index + 1] ?? asks[index - 1];
    setFocusId(next?.id ?? null);
  }, [asks, index]);

  const branches = useMemo(() => {
    if (!ask) return [] as string[];
    if (ask.kind === 'review') return ask.actions;
    return ask.complex ? [m.quick_open_builder] : ask.options;
  }, [ask, m.quick_open_builder]);

  const accept = useCallback(() => {
    if (!ask || writes.busy) return;
    if (ask.kind === 'review') { advance(); void writes.approve(ask); return; }
    if (ask.complex) return;
    setPrompt({
      on: 'answer', title: ask.title, freeText: true, skipLabel: m.triage_defer, placeholder: m.quick_answer_placeholder,
      options: ask.options.map((o) => ({ id: o, label: o, value: o })),
    });
  }, [ask, writes, advance, m]);

  const reject = useCallback(() => {
    if (!ask || writes.busy) return;
    if (ask.kind === 'question') { walk(1); return; }
    setPrompt({ on: 'reject', title: m.triage_reason_title, options: [], freeText: true, skipLabel: m.triage_reason_skip, placeholder: m.quick_note });
  }, [ask, writes.busy, walk, m]);

  const submitPrompt = useCallback((text?: string) => {
    if (!ask || !prompt) return;
    setPrompt(null);
    if (prompt.on === 'reject' && ask.kind === 'review') { advance(); void writes.reject(ask, text); return; }
    if (prompt.on === 'answer' && ask.kind === 'question') {
      if (!text) { walk(1); return; } // Enter with nothing typed leaves it for later
      advance();
      void writes.answer(ask, text);
    }
  }, [ask, prompt, writes, advance, walk]);

  /** 1-based: false when there is no such branch (the key is not consumed). */
  const branch = useCallback((n: number): boolean => {
    const label = branches[n - 1];
    if (!ask || !label || writes.busy) return false;
    if (ask.kind === 'review') { advance(); void writes.branch(ask, label); return true; }
    if (ask.complex) { openBuilder(ask.personaId); return true; }
    advance();
    void writes.answer(ask, label);
    return true;
  }, [ask, branches, writes, advance]);

  return {
    ask, index, total: asks.length, prompt, branches, busy: writes.busy,
    focus: setFocusId, walk, accept, reject, skip: () => walk(1), branch, submitPrompt, cancelPrompt: () => setPrompt(null),
  };
}

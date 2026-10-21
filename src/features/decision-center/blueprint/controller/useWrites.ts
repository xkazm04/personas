// The sheet's write side. Every write goes through `actions` (the frozen BlueprintActions seam), is printed in the
// dock console exactly as the store answered it (`decided[]`, `skipped[]` with each reason, the started command),
// and is followed by a re-read: the statuses on the plan are always the store's, never the sheet's guess. A triage
// (WP4b) is never withheld on the state table's `from`: it is sent, and a refusal comes back as the store's own
// `skipped[]` row with its reason, which the console prints.
import { useCallback, useMemo, useRef, type Dispatch } from 'react';
import type { BlueprintActions, TriageDecisionInput } from '../source';
import type { Work, WorkItem } from '../model/work';
import { actable, MOVES } from '../model/states';
import type { NoteMove, UiAction, UiState } from '../state/uiState';
import { extractMessage } from '@/lib/silentCatch';

export interface Writes {
  approve(p: WorkItem | null): Promise<void>;
  /** Ask the reason first (the dialog); the answer comes back through `decline`. */
  askDecline(p: WorkItem | null): void;
  decline(p: WorkItem, note: string): Promise<void>;
  /** B once: arm every approved item. B again (or Enter) confirms. */
  arm(): void;
  confirm(): Promise<void>;
  disarm(): void;
  /** A triage key or control: asks the note first when the state table's NoteRule wants one, else sends at once. */
  askTriage(p: WorkItem | null, move: TriageDecisionInput): void;
  triage(p: WorkItem, move: TriageDecisionInput, note?: string): Promise<void>;
  /**
   * Batch moves over several items (bp's multi-select and the ledger's checked rows): ONE store call with every id,
   * printed and re-read like a single move; the selection is cleared after. `askMany` opens the note prompt first when
   * the move wants one (decline always; rework / descope / a failed accept per the state table).
   */
  askMany(ids: string[], move: 'decline' | TriageDecisionInput): void;
  decideMany(ids: string[], decision: 'approve' | 'decline', note?: string): Promise<void>;
  triageMany(ids: string[], move: TriageDecisionInput, note?: string): Promise<void>;
}

export type Verb = 'approve' | 'decline' | 'build' | TriageDecisionInput;

interface Deps {
  actions: BlueprintActions;
  work: Work;
  ui: UiState;
  dispatch: Dispatch<UiAction>;
  reload: () => Promise<boolean>;
  /** Words the status line says; resolved by the caller from translations. */
  say: Say;
  /** Called with the proposal ids a write is about to send, so the changes it causes are not announced as news. */
  sent?: (ids: readonly string[]) => void;
}

/** What the status line may say after a move; each is one translated sentence. */
export interface Say {
  pickFirst(): string;
  nothingToMove(move: 'approve' | 'decline' | 'build'): string;
  armed(n: number, jobs: number): string;
  sent(verb: Verb, decided: number, skipped: number): string;
  failed(message: string): string;
  disarmed(): string;
}

const errText = (e: unknown): string => extractMessage(e);

export function useWrites({ actions, work, ui, dispatch, reload, say, sent }: Deps): Writes {
  const lock = useRef(false);
  const run = useCallback(async (fn: () => Promise<void>, move?: string) => {
    if (lock.current) return;
    lock.current = true; dispatch({ type: 'busy', on: true, move });
    try { await fn(); } finally { lock.current = false; dispatch({ type: 'busy', on: false }); }
  }, [dispatch]);

  const decideOne = useCallback(async (p: WorkItem, decision: 'approve' | 'decline', note?: string) => {
    await run(async () => {
      if (!actable(decision, p.status)) { dispatch({ type: 'say', text: say.nothingToMove(decision) }); return; }
      try {
        sent?.([p.id]);
        const result = await actions.decide([p.id], decision, note);
        dispatch({ type: 'print', line: { kind: 'decide', decision, ids: [p.id], note, result } });
        dispatch({ type: 'say', text: say.sent(decision, result.decided.length, result.skipped.length) });
      } catch (e) {
        dispatch({ type: 'print', line: { kind: 'failed', verb: 'decide', message: errText(e) } });
        dispatch({ type: 'say', text: say.failed(errText(e)) });
      }
      await reload();
    });
  }, [actions, dispatch, reload, run, say, sent]);

  const approve = useCallback(async (p: WorkItem | null) => {
    if (!p) { dispatch({ type: 'say', text: say.pickFirst() }); return; }
    await decideOne(p, 'approve');
  }, [decideOne, dispatch, say]);

  const askDecline = useCallback((p: WorkItem | null) => {
    if (!p) { dispatch({ type: 'say', text: say.pickFirst() }); return; }
    if (!actable('decline', p.status)) { dispatch({ type: 'say', text: say.nothingToMove('decline') }); return; }
    dispatch({ type: 'overlay', overlay: { kind: 'reason', itemId: p.id, move: 'decline' } });
  }, [dispatch, say]);

  const decline = useCallback(async (p: WorkItem, note: string) => {
    dispatch({ type: 'overlay', overlay: null });
    await decideOne(p, 'decline', note);
  }, [decideOne, dispatch]);

  const arm = useCallback(() => {
    const ok = work.items.filter((p) => actable('build', p.status));
    if (!ok.length) { dispatch({ type: 'say', text: say.nothingToMove('build') }); return; }
    const jobs = new Set(ok.map((p) => p.lens)).size;
    dispatch({ type: 'arm', ids: ok.map((p) => p.id) });
    dispatch({ type: 'say', text: say.armed(ok.length, jobs) });
  }, [work, dispatch, say]);

  const disarm = useCallback(() => { dispatch({ type: 'arm', ids: null }); dispatch({ type: 'say', text: say.disarmed() }); }, [dispatch, say]);

  const confirm = useCallback(async () => {
    const ids = ui.armed;
    if (!ids) return;
    dispatch({ type: 'arm', ids: null });
    await run(async () => {
      const rows = ids.map((id) => work.byId.get(id)).filter((p): p is WorkItem => !!p && actable('build', p.status));
      const byLens = new Map<string, string[]>();
      for (const p of rows) byLens.set(p.lens, [...(byLens.get(p.lens) ?? []), p.id]);
      sent?.(rows.map((p) => p.id));
      // one job per lens; never --approve-proposed: only the approved ids go
      for (const [lens, list] of byLens) {
        try {
          const result = await actions.start({ action: 'execute', lens, ids: list });
          dispatch({ type: 'print', line: { kind: 'start', lens, ids: list, result } });
        } catch (e) {
          dispatch({ type: 'print', line: { kind: 'failed', verb: 'start', message: errText(e) } });
          dispatch({ type: 'say', text: say.failed(errText(e)) });
        }
      }
      if (rows.length) dispatch({ type: 'say', text: say.sent('build', rows.length, ids.length - rows.length) });
      await reload();
    });
  }, [ui.armed, work, actions, dispatch, reload, run, say, sent]);

  const triage = useCallback(async (p: WorkItem, move: TriageDecisionInput, note?: string) => {
    if (ui.overlay?.kind === 'reason') dispatch({ type: 'overlay', overlay: null });
    await run(async () => {
      try {
        sent?.([p.id]);
        const result = await actions.triage([p.id], move, note);
        dispatch({ type: 'print', line: { kind: 'triage', decision: move, ids: [p.id], note, result } });
        dispatch({ type: 'say', text: say.sent(move, result.triaged.length, result.skipped.length) });
      } catch (e) {
        dispatch({ type: 'print', line: { kind: 'failed', verb: 'triage', message: errText(e) } });
        dispatch({ type: 'say', text: say.failed(errText(e)) });
      }
      await reload();
    }, move);
  }, [ui.overlay, actions, dispatch, reload, run, say, sent]);

  const askTriage = useCallback((p: WorkItem | null, move: TriageDecisionInput) => {
    if (!p) { dispatch({ type: 'say', text: say.pickFirst() }); return; }
    const rule = MOVES[move].note;
    if (move !== 'reopen' && (rule === 'asked' || (rule === 'when-failed' && p.status === 'failed'))) {
      dispatch({ type: 'overlay', overlay: { kind: 'reason', itemId: p.id, move: move as NoteMove } });
      return;
    }
    void triage(p, move);
  }, [dispatch, say, triage]);

  const decideMany = useCallback(async (ids: string[], decision: 'approve' | 'decline', note?: string) => {
    if (ui.overlay?.kind === 'reason') dispatch({ type: 'overlay', overlay: null });
    if (!ids.length) { dispatch({ type: 'say', text: say.pickFirst() }); return; }
    await run(async () => {
      try {
        sent?.(ids);
        const result = await actions.decide(ids, decision, note);
        dispatch({ type: 'print', line: { kind: 'decide', decision, ids, note, result } });
        dispatch({ type: 'say', text: say.sent(decision, result.decided.length, result.skipped.length) });
      } catch (e) {
        dispatch({ type: 'print', line: { kind: 'failed', verb: 'decide', message: errText(e) } });
        dispatch({ type: 'say', text: say.failed(errText(e)) });
      }
      dispatch({ type: 'selectClear' });
      await reload();
    }, decision);
  }, [ui.overlay, actions, dispatch, reload, run, say, sent]);

  const triageMany = useCallback(async (ids: string[], move: TriageDecisionInput, note?: string) => {
    if (ui.overlay?.kind === 'reason') dispatch({ type: 'overlay', overlay: null });
    if (!ids.length) { dispatch({ type: 'say', text: say.pickFirst() }); return; }
    await run(async () => {
      try {
        sent?.(ids);
        const result = await actions.triage(ids, move, note);
        dispatch({ type: 'print', line: { kind: 'triage', decision: move, ids, note, result } });
        dispatch({ type: 'say', text: say.sent(move, result.triaged.length, result.skipped.length) });
      } catch (e) {
        dispatch({ type: 'print', line: { kind: 'failed', verb: 'triage', message: errText(e) } });
        dispatch({ type: 'say', text: say.failed(errText(e)) });
      }
      dispatch({ type: 'selectClear' });
      await reload();
    }, move);
  }, [ui.overlay, actions, dispatch, reload, run, say, sent]);

  const askMany = useCallback((ids: string[], move: 'decline' | TriageDecisionInput) => {
    if (!ids.length) { dispatch({ type: 'say', text: say.pickFirst() }); return; }
    const rule = move === 'decline' ? 'asked' : MOVES[move].note;
    const anyFailed = ids.some((id) => work.byId.get(id)?.status === 'failed');
    if (move !== 'reopen' && (rule === 'asked' || (rule === 'when-failed' && anyFailed))) {
      dispatch({ type: 'overlay', overlay: { kind: 'reason', itemId: ids[0]!, ids, move: move as NoteMove } });
      return;
    }
    void triageMany(ids, move as TriageDecisionInput);
  }, [dispatch, say, work, triageMany]);

  return useMemo(
    () => ({ approve, askDecline, decline, arm, confirm, disarm, askTriage, triage, askMany, decideMany, triageMany }),
    [approve, askDecline, decline, arm, confirm, disarm, askTriage, triage, askMany, decideMany, triageMany],
  );
}

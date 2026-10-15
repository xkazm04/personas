// The sheet's write side. Every write goes through `actions` (the frozen BlueprintActions seam), is printed in the
// dock console exactly as the store answered it (`decided[]`, `skipped[]` with each reason, the started command),
// and is followed by a re-read: the statuses on the plan are always the store's, never the sheet's guess.
import { useCallback, useMemo, useRef, type Dispatch } from 'react';
import type { BlueprintActions } from '../source';
import type { Work, WorkItem } from '../model/work';
import { actable } from '../model/states';
import type { UiAction, UiState } from '../state/uiState';

export interface Writes {
  approve(p: WorkItem | null): Promise<void>;
  /** Ask the reason first (the dialog); the answer comes back through `decline`. */
  askDecline(p: WorkItem | null): void;
  decline(p: WorkItem, note: string): Promise<void>;
  /** B once: arm every approved item. B again (or Enter) confirms. */
  arm(): void;
  confirm(): Promise<void>;
  disarm(): void;
}

interface Deps {
  actions: BlueprintActions;
  work: Work;
  ui: UiState;
  dispatch: Dispatch<UiAction>;
  reload: () => Promise<boolean>;
  /** Words the status line says; resolved by the caller from translations. */
  say: Say;
}

/** What the status line may say after a move; each is one translated sentence. */
export interface Say {
  pickFirst(): string;
  nothingToMove(move: 'approve' | 'decline' | 'build'): string;
  armed(n: number, jobs: number): string;
  sent(verb: 'approve' | 'decline' | 'build', decided: number, skipped: number): string;
  failed(message: string): string;
  disarmed(): string;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useWrites({ actions, work, ui, dispatch, reload, say }: Deps): Writes {
  const lock = useRef(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; dispatch({ type: 'busy', on: true });
    try { await fn(); } finally { lock.current = false; dispatch({ type: 'busy', on: false }); }
  }, [dispatch]);

  const decideOne = useCallback(async (p: WorkItem, decision: 'approve' | 'decline', note?: string) => {
    await run(async () => {
      if (!actable(decision, p.status)) { dispatch({ type: 'say', text: say.nothingToMove(decision) }); return; }
      try {
        const result = await actions.decide([p.id], decision, note);
        dispatch({ type: 'print', line: { kind: 'decide', decision, ids: [p.id], note, result } });
        dispatch({ type: 'say', text: say.sent(decision, result.decided.length, result.skipped.length) });
      } catch (e) {
        dispatch({ type: 'print', line: { kind: 'failed', verb: 'decide', message: errText(e) } });
        dispatch({ type: 'say', text: say.failed(errText(e)) });
      }
      await reload();
    });
  }, [actions, dispatch, reload, run, say]);

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
  }, [ui.armed, work, actions, dispatch, reload, run, say]);

  return useMemo(() => ({ approve, askDecline, decline, arm, confirm, disarm }), [approve, askDecline, decline, arm, confirm, disarm]);
}

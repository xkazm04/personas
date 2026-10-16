import { useSheet } from '../controller/SheetContext';
import type { BpText } from '../controller/useBlueprintText';
import { canDecide, TRIAGE_FROM } from '../model/ledgerRules';
import { capOf, keysFor, type KeyAct } from '../model/keymap';
import type { TriageDecisionInput } from '../source';
import { Btn, type BtnTone } from './Controls';

const MARK: Record<TriageDecisionInput, string> = { reopen: '', accept: '✓ ', rework: '↺ ', descope: '⊘ ' };
const TONE: Partial<Record<TriageDecisionInput, BtnTone>> = { accept: 'acc', rework: 'rw', descope: 'ds' };
const word = (B: BpText, d: TriageDecisionInput) => ({ accept: B.verb_accept, rework: B.verb_rework, descope: B.verb_descope, reopen: B.verb_reopen })[d];

/** Why no item of the set can take the decision (the disabled control's hint), or null when some can. */
function whyNot(B: BpText, tx: ReturnType<typeof useSheet>['text']['tx'], ids: readonly string[], d: TriageDecisionInput, rows: ReturnType<typeof useSheet>['data']['scan']): string | null {
  if (!ids.length) return B.lg_pick_first;
  const ps = ids.map((id) => rows.proposals.find((p) => p.id === id)).filter((p) => p !== undefined);
  if (ps.some((p) => canDecide(d, p, p.release_id ? rows.releases.find((r) => r.id === p.release_id) : undefined))) return null;
  return d === 'reopen' ? B.lg_why_undo : tx(B.lg_why_move, { move: word(B, d), from: TRIAGE_FROM[d].join(', ') });
}

/**
 * The one set of triage controls (bp Decide): Undo, Accept n, Rework, Descope, each with its key from the one keymap,
 * over the items a decision acts on. `compact` is the compare footer's strip (Undo only while there is something to
 * undo). A control no item can take is shown disabled with the reason; the key still sends (the store has the last
 * word, and the dock console prints its answer). Only the pressed control's move shows the busy state.
 */
export function Decide({ ids, compact = false, onMove }: { ids: readonly string[]; compact?: boolean; onMove(move: TriageDecisionInput): void }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const btn = (d: TriageDecisionInput) => {
    const why = whyNot(B, tx, ids, d, s.data.scan);
    const key = keysFor(d as KeyAct)[0];
    const label = MARK[d] + word(B, d) + (d === 'accept' && !compact && ids.length ? ' ' + ids.length : '');
    return (
      <Btn key={d} tone={TONE[d]} kbd={key ? capOf(key) : undefined} disabled={!!why} tip={why ?? undefined} onClick={() => onMove(d)} testId={'blueprint-triage-' + d}>
        {label}
      </Btn>
    );
  };
  const undo = !compact || !whyNot(B, tx, ids, 'reopen', s.data.scan);
  return (
    <span className={'tr-decide' + (compact ? ' compact' : '')} role="group" aria-label={B.cmp_triage} aria-busy={s.ui.busy || undefined}>
      {undo ? btn('reopen') : null}
      {btn('accept')}
      {btn('rework')}
      {btn('descope')}
    </span>
  );
}

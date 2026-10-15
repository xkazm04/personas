import { Button, type ButtonTone, type ButtonVariant } from '@/features/shared/components/buttons';
import { useSheet } from '../../controller/SheetContext';
import { keysFor, type KeyAct } from '../../model/keymap';
import { STATUS } from '../../model/states';
import type { WorkItem } from '../../model/work';
import type { TriageDecisionInput } from '../../source';
import { Keycap } from '../Keycap';
import { nextHint, statusWord } from '../StatusChip';

const MOVES: readonly { move: TriageDecisionInput; variant: ButtonVariant; tone?: ButtonTone }[] = [
  { move: 'accept', variant: 'accent', tone: 'success' },
  { move: 'rework', variant: 'accent', tone: 'warning' },
  { move: 'descope', variant: 'secondary' },
  { move: 'reopen', variant: 'ghost' },
];

/**
 * The compare panel's foot (bp ComparePanel footer + Decide, compact): the item's state over its triage note (or what
 * the state means), and the four triage controls with their keys. Every control is always offered: the store decides,
 * and its answer (with each refusal's reason) prints in the dock console. Only the pressed control shows a spinner.
 */
export function TriageBar({ p }: { p: WorkItem }) {
  const s = useSheet();
  const { B } = s.text;
  const word = { accept: B.verb_accept, rework: B.verb_rework, descope: B.verb_descope, reopen: B.verb_reopen };
  const note = p.row.triage_note;
  return (
    <footer className="bp-cmp-d">
      <span className={`bp-done bp-tone-${STATUS[p.status].tone}`} data-testid="blueprint-cmp-state">
        <span className="typo-eyebrow">{statusWord(B, p.status)}</span> <span className="typo-body">{note ? `“${note}”` : nextHint(B, p.status)}</span>
        {p.row.release_id ? <> {'·'} <span className="typo-code">{p.row.release_id}</span></> : null}
      </span>
      <span className="bp-tri" role="group" aria-label={B.cmp_triage}>
        {MOVES.map(({ move, variant, tone }) => (
          <Button
            key={move}
            variant={variant}
            tone={tone}
            size="sm"
            loading={s.ui.busy && s.ui.pending === move}
            onClick={() => { s.nav.select(p); s.writes.askTriage(p, move); }}
            iconRight={<Keycap k={keysFor(move as KeyAct)[0] ?? ''} />}
            data-testid={`blueprint-triage-${move}`}
          >
            {word[move]}
          </Button>
        ))}
      </span>
    </footer>
  );
}

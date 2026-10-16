import { useSheet } from '../controller/SheetContext';
import type { BpText } from '../controller/useBlueprintText';
import { KEYMAP, type KeyAct, type KeyGroup } from '../model/keymap';
import { BpDialog } from './dialog/BpDialog';
import { Keycaps } from './Keycap';

const GROUPS: KeyGroup[] = ['walk', 'decide', 'triage', 'move', 'sheets'];

/** The sentence each action carries in the key sheet. */
const TEXT: Record<KeyAct, keyof BpText> = {
  next: 'key_next', prev: 'key_prev', find: 'key_find', queue: 'key_queue', approve: 'key_approve', decline: 'key_decline', build: 'key_build',
  accept: 'key_accept', rework: 'key_rework', descope: 'key_descope', reopen: 'key_reopen',
  enter: 'key_enter', back: 'key_back', wingNext: 'key_wing_next', wingPrev: 'key_wing_prev', site: 'key_site', zoomOut: 'key_zoom_out', zoomIn: 'key_zoom_in',
  lens: 'key_lens', help: 'key_help', ledger: 'key_ledger', timeline: 'key_timeline', select: 'key_select',
};

/** The key sheet (?): the one keymap, in five groups. Any key closes it (the sheet's handler does that). */
export function KeySheet() {
  const s = useSheet();
  const { B } = s.text;
  const close = () => s.dispatch({ type: 'overlay', overlay: null });
  const title = (g: KeyGroup) => ({ walk: B.keys_walk, decide: B.keys_decide, triage: B.keys_triage, move: B.keys_move, sheets: B.keys_sheets })[g];
  return (
    <BpDialog onClose={close} titleId="bp-keys-title" width="lg" title={B.keys_title} sub={B.keys_any_closes}>
      <div className="bp-keys">
        {GROUPS.map((g) => (
          <section key={g} className="bp-kg" aria-label={title(g)}>
            <h3>{title(g)}</h3>
            {KEYMAP.filter((b) => b.group === g).map((b) => (
              <div key={b.act} className="bp-kr">
                <span className="bp-kc"><Keycaps keys={b.keys} max={b.act === 'lens' ? 1 : 2} />{b.act === 'lens' && <span>1 - 9</span>}</span>
                <span>{B[TEXT[b.act]]}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </BpDialog>
  );
}

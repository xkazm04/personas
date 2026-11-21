// PORTED from bp apps/web/src/components/timeline/Strip.tsx @ 93f30b0 (the strip's compare cell): with baseline A
// pinned, "SINCE <A> · N CHANGED" and UNPIN A; otherwise PIN A, which pins the travelled date as A.
// EDIT (port): the comparison is the sheet's (`sync`, controller/useSyncModels); N is the comparison's feature count
// (bp cmpN = cmp.ids.length), 0 while B is A itself. PIN A shows only when travelled (WP3 brief: at now P has nothing
// to pin and says why); bp offers it at now too. The key is P here (A is approve), shown as the control's keycap.
import { useSheet } from '../../controller/SheetContext';
import { Press } from '../Press';
import { fmtDay } from './dates';

export function SyncPos({ now }: { now: boolean }) {
  const s = useSheet(), { B, tx, language } = s.text, a = s.ui.cmpA;
  if (a) {
    const n = s.sync.comparison?.ids.length ?? 0;
    return (
      <span className="tl-pos tl-cmp" role="status" data-testid="blueprint-cmp-since">
        <span className="tl-cmpw">{tx(B.sync_since, { date: fmtDay(language, a), count: n })}</span>
        <Press tone="tl-back" onClick={s.sync.unpinA} data-testid="blueprint-unpin-a">{B.sync_unpin_a}</Press>
      </span>
    );
  }
  if (now) return null;
  return <Press tone="tl-back" onClick={s.sync.pinA} data-testid="blueprint-pin-a">{B.sync_pin_a}<kbd aria-hidden="true">P</kbd></Press>;
}

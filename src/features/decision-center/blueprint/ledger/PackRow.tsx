import { memo, useLayoutEffect, useRef } from 'react';
import type { Pack, ProposalStatus } from '@/lib/lensScan/wire';
import { useSheet } from '../controller/SheetContext';
import { WAITING } from '../model/ledgerRules';
import { LensGlyphIcon } from '../ui/LensGlyphIcon';
import { StateMark } from './Marks';

export interface PackRowProps {
  pack: Pack;
  /** Every item of the pack (the progress), id and status. */
  items: readonly { id: string; status: ProposalStatus }[];
  /** The pack's shown items are all checked (the checkbox), some are (indeterminate). */
  all: boolean;
  some: boolean;
  onCheck(packId: string): void;
}

/**
 * A pack's own row in the In packs table (bp PackRow), sticky under the head row while its items scroll: a checkbox
 * that checks every shown item, the lens glyph and the pack id, branch, base commit, item count and state, then one
 * progress mark per item and "n/m decided".
 */
export const PackRow = memo(function PackRow({ pack, items, all, some, onCheck }: PackRowProps) {
  const s = useSheet();
  const { B, tx } = s.text;
  const box = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { if (box.current) box.current.indeterminate = some && !all; }, [some, all]);
  const decided = items.filter((x) => !WAITING.has(x.status)).length, n = items.length;
  return (
    <div className={'tr-pk' + (pack.status === 'closed' ? ' closed' : '')} data-pack={pack.id} data-testid="blueprint-ledger-pack">
      <input ref={box} type="checkbox" checked={all} onChange={() => onCheck(pack.id)} aria-label={tx(B.lg_check_pack, { id: pack.id })} tabIndex={-1} />
      <h3><LensGlyphIcon glyph={s.plan.LENS[pack.lens]?.glyph ?? null} />{pack.id}</h3>
      <span className="meta"><code>{pack.branch}</code> · {B.lg_base} <code>{pack.base_sha.slice(0, 7)}</code> · {tx(B.lg_pack_items, { n })} · {B.lg_stacked} · {B[`lg_pk_${pack.status}` as const]}</span>
      <span className="prog" aria-label={tx(B.lg_decided_label, { decided, n })}>
        {items.map((x) => <StateMark key={x.id} status={x.status} form="box" />)}
        <em>{tx(B.lg_decided, { decided, n })}</em>
      </span>
    </div>
  );
});

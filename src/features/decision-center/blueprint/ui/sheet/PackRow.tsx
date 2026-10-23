import { useMemo } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { STATUS } from '../../model/states';
import { comparisonOf } from '../../model/triage';
import type { WorkItem } from '../../model/work';
import { VerdictChip } from '../compare/MetricLine';
import { LensGlyphIcon } from '../LensGlyphIcon';
import { Press } from '../Press';
import { StatusChip } from '../StatusChip';

/**
 * One built item of a pack on the L4 sheet (bp ItemRow, the triage table's row): glyph, title, the store's status, the
 * metric verdict from its own before and after readings, and its id, pack and commit. Pressing it opens the compare
 * panel on it; the row of the item the panel shows is the current one.
 */
export function PackRow({ p }: { p: WorkItem }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const c = useMemo(() => comparisonOf(s.data.scan, s.plan, p.id), [s.data.scan, s.plan, p.id]);
  const L = s.plan.LENS[p.lens];
  const accent = s.engine ? s.engine.accentOf(p.lens) : undefined;
  const on = s.ui.compare === p.id;
  return (
    <Press tone={`bp-pk-row bp-tone-${STATUS[p.status].tone}`} current={on} onClick={() => s.nav.compare(p)} aria-label={tx(B.cmp_open, { title: p.title })} data-item={p.id} data-status={p.status} data-testid="blueprint-pack-row">
      <span className="bp-g" style={accent ? { color: accent } : undefined}><LensGlyphIcon glyph={L?.glyph ?? null} /></span>
      <span className="bp-pk-t typo-body">{p.title}</span>
      <span className="bp-pk-c"><StatusChip B={B} status={p.status} />{c ? <VerdictChip B={B} verdict={c.verdict} /> : null}</span>
      <span className="bp-pk-m typo-code">{p.id} {'·'} {p.pack}{p.row.commit_sha ? ` · ${p.row.commit_sha.slice(0, 7)}` : ''}</span>
    </Press>
  );
}

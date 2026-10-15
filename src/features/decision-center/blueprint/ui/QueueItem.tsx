import { useSheet } from '../controller/SheetContext';
import { STATUS } from '../model/states';
import type { WorkItem } from '../model/work';
import { deltaText } from './format';
import { LensGlyphIcon } from './LensGlyphIcon';
import { Press } from './Press';
import { StatusChip } from './StatusChip';

/** One item of the Build queue: the lens glyph in the lens's colour, the title, where it moves the metric, size and risk. The current row wears the plan's focus ring. */
export function QueueItem({ p }: { p: WorkItem }) {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const L = s.plan.LENS[p.lens];
  const open = () => { if (s.ui.itemId === p.id) s.nav.openSheet(p.fid); else s.nav.select(p, true); };
  const accent = s.engine ? s.engine.accentOf(p.lens) : undefined;
  return (
    <Press
      tone={`bp-it bp-tone-${STATUS[p.status].tone}`}
      current={s.ui.itemId === p.id}
      onClick={open}
      onMouseEnter={() => { if (s.engine) { s.engine.hot = p.fid; s.engine.dirty = true; } }}
      onMouseLeave={() => { if (s.engine) { s.engine.hot = null; s.engine.dirty = true; } }}
      data-item={p.id}
      data-status={p.status}
    >
      <span className="bp-g" style={accent ? { color: accent } : undefined}><LensGlyphIcon glyph={L?.glyph ?? null} /></span>
      <span className="bp-tt typo-body">{p.title}</span>
      <span className="bp-d typo-body"><span className="typo-code">{L?.short ?? p.lens}</span><span>{deltaText(s.plan, p, language)}</span></span>
      <span className="bp-d2 typo-body">
        <span className="typo-code">{tx(B.size_risk, { size: p.size, risk: p.risk ?? '-' })}</span>
        {p.status !== 'proposed' && <StatusChip B={B} status={p.status} />}
      </span>
    </Press>
  );
}

import { useSheet } from '../controller/SheetContext';
import { STATUS } from '../model/states';
import type { WorkItem } from '../model/work';
import { deltaText } from './format';
import { LensGlyphIcon } from './LensGlyphIcon';
import { Press } from './Press';
import { statusWord } from './StatusChip';

/** Risk at or above this (of 10) reads as urgent: the row's edge turns red while it waits. */
const HIGH_RISK = 7;

/**
 * One item of the Build queue as bp's workbench row (bp rail/wide/workbench.css .wb-row): a 5 px edge in the item's
 * urgency (waiting amber, a risky wait or a failed build red, approved and accepted mint), a 12 px mono kicker (the
 * lens glyph in its accent, its short code, the state's word), the title on at most two lines, and the move on the
 * metric with size and risk. The current row is filled 13% ink with a 3 px accent inset; hovering it lights the
 * feature on the plan.
 */
export function QueueItem({ p }: { p: WorkItem }) {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const L = s.plan.LENS[p.lens];
  const open = () => { if (s.ui.itemId === p.id) s.nav.openSheet(p.fid); else s.nav.select(p, true); };
  const accent = s.engine ? s.engine.accentOf(p.lens) : undefined;
  const tone = STATUS[p.status].tone;
  // a build this sheet started for the item is still in flight on the fleet: the row says so until it settles
  const building = s.live.building.has(p.id);
  const urg = p.status === 'proposed' && (p.risk ?? 0) >= HIGH_RISK ? 'high' : tone;
  return (
    <Press
      tone={`bp-it u-${urg} bp-tone-${tone}${building ? ' is-building' : ''}`}
      current={s.ui.itemId === p.id}
      onClick={open}
      onMouseEnter={() => { if (s.engine) { s.engine.hot = p.fid; s.engine.dirty = true; } }}
      onMouseLeave={() => { if (s.engine) { s.engine.hot = null; s.engine.dirty = true; } }}
      data-item={p.id}
      data-status={p.status}
      data-building={building ? 'true' : undefined}
    >
      <span className="urg" aria-hidden="true" />
      <span className="rk">
        <span className="lz"><span className="bp-g" style={accent ? { color: accent } : undefined}><LensGlyphIcon glyph={L?.glyph ?? null} /></span>{L?.short ?? p.lens}</span>
        <span className="uw">{building ? B.item_building : statusWord(B, p.status)}</span>
      </span>
      <span className="rt">{p.title}</span>
      <span className="rm"><span>{deltaText(s.plan, p, language)}</span><span>{tx(B.size_risk, { size: p.size, risk: p.risk ?? '-' })}</span></span>
    </Press>
  );
}

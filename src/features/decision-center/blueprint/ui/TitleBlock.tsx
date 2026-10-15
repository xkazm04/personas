import { X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSheet } from '../controller/SheetContext';
import { Crumbs } from './Crumbs';
import { LensTabs } from './LensTabs';

/** The sheet number the title block prints: G-001 for the General arrangement, <lens short>-10<n> for a lens sheet. */
export function sheetNumber(short: string | null, i: number): string {
  return short ? `${short}-10${i + 1}` : 'G-001';
}

/**
 * The title block (bp Header): an opaque band with a double rule, so canvas headings never show through under it.
 * Identity line (drawing set, queue count, sheet), the last thing the sheet said, the crumbs, the last scan, the
 * lens sheets and the way out.
 */
export function TitleBlock() {
  const s = useSheet();
  const { B } = s.text;
  const L = s.ui.lens === 'general' ? null : s.plan.LENS[s.ui.lens] ?? null;
  const name = L ? L.name : B.general_arrangement;
  return (
    <header className="bp-hd">
      <div className="bp-id">
        <div className="bp-l1 typo-label">
          <span className="bp-chip-ds">{B.drawing_set}</span>
          <span>{B.ledger} <b className="bp-wait">{s.queueAll.length}</b></span>
          <span className="bp-sheetno">{B.sheet} {sheetNumber(L ? L.short : null, L ? L.i : 0)} {'·'} {name}</span>
          <span className="bp-scan-l" data-testid="blueprint-scan"><span className="bp-dot" aria-hidden="true" />{B.last_scan} <RelativeTime timestamp={s.work.lastRun} fallback={B.never} showTooltip={false} /></span>
          <span className="bp-say" role="status" aria-live="polite" key={s.ui.say?.key ?? 0}>{s.ui.say?.text ?? ''}</span>
        </div>
        <Crumbs />
      </div>
      <LensTabs />
      <Button variant="ghost" size="icon-md" onClick={s.onClose} aria-label={B.close} data-testid="blueprint-close"><X className="w-4 h-4" /></Button>
    </header>
  );
}

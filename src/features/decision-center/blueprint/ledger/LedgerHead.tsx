import type { ReactNode } from 'react';
import { useSheet } from '../controller/SheetContext';
import { Btn } from './Controls';
import { SummaryStrip } from './release/SummaryStrip';
import { useBpOpen } from './useBpOpen';
import type { Ledger } from './useLedger';

/**
 * The ledger's head (bp LedgerPage `.lg-top`): FINDINGS LEDGER over the product line (product, findings, items in
 * packs), the summary strip at the right, then the tab strip (passed in: it lives in the same file as its tab panel)
 * and the LENSES button with the number of lenses, which opens bp (lens authoring stays in bp, operator decision).
 */
export function LedgerHead({ L, tabs }: { L: Ledger; tabs: ReactNode }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const bp = useBpOpen();
  const line = tx(B.lg_product_line, { product: s.data.product.name, findings: L.all.length, items: L.items.length, packs: L.packs.length });
  return (
    <header className="lg-top">
      <div className="lg-h">
        <h2 id="bp-ledger-title">{B.lg_title}</h2>
        <span className="lg-prod">{line}</span>
      </div>
      <SummaryStrip />
      {tabs}
      <span className="lg-slot">
        <Btn tip={B.lg_lenses_tip} onClick={bp.openLedger} disabled={!bp.releaseUrl} testId="blueprint-ledger-lenses">
          <span aria-hidden="true">⌕</span> {B.lg_lenses}<b className="lg-n">{L.lenses.filter((l) => l.enabled).length}</b>
        </Btn>
      </span>
    </header>
  );
}

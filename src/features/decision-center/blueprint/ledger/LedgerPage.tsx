// bp's findings ledger (bp/src/components/ledger/LedgerPage.tsx), the second page over one product: Triage table,
// Feature x lens matrix, Release (read-only). Mounted by BlueprintSheet while `ui.page === 'ledger'` (key L); it covers
// the rail and the timeline as bp's does (they act on the plan and have nothing to say about a list) and takes the
// plan's full width. The chrome it covers is inert while it shows. The head, the filters, the body (a table, the matrix
// or the release) with the compare panel docked beside a pack item, and the bar at the foot. Keys: useLedgerKeys.
import '../styles/ledger.css';
import '../styles/ledger-train.css';
import '../styles/ledger-release.css';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useSheet } from '../controller/SheetContext';
import { LEDGER_TABS, type LedgerTab } from '../model/ledger';
import { Press } from '../ui/Press';
import { ComparePanel } from '../ui/compare/ComparePanel';
import { DecisionBar } from './DecisionBar';
import { DispatchBar } from './DispatchBar';
import { Filters } from './Filters';
import { LedgerHead } from './LedgerHead';
import { Matrix } from './Matrix';
import { PackTable } from './PackTable';
import { Triage } from './Triage';
import { ReleaseView } from './release/ReleaseView';
import { setLedger, setTab } from './ledgerStore';
import { useLedger } from './useLedger';
import { useLedgerActs } from './useLedgerActs';
import { useLedgerKeys } from './useLedgerKeys';

/** bp opens the first pack item in the compare panel on a window wider than this, once per product. */
const AUTO_OPEN_MIN_W = 1100;

export function LedgerPage() {
  const s = useSheet();
  const { B } = s.text;
  const L = useLedger(), acts = useLedgerActs(L);
  const root = useRef<HTMLElement>(null), filter = useRef<HTMLInputElement>(null);
  useLedgerKeys(L, acts, filter);
  const { tab, scope, open, wide } = L.ui, packs = scope === 'packs';
  // the compare panel docks beside the table AND the matrix while a pack item is open (bp: the release tab has none)
  const cmpOpen = tab !== 'release' && packs && !!open;

  // the plan's chrome behind the page is inert while it shows (Tab never lands behind it); the header stays live
  useLayoutEffect(() => {
    const page = root.current, host = page?.closest('.bp-plan'), held: HTMLElement[] = [];
    host?.querySelectorAll<HTMLElement>(':scope > *').forEach((el) => {
      if (el === page || el.contains(page) || el.classList.contains('bp-hd')) return;
      if (!el.inert) { el.inert = true; held.push(el); }
    });
    page?.focus({ preventScroll: true });
    return () => { for (const el of held) el.inert = false; };
  }, []);

  // a wide window opens the first pack item in the compare panel the first time (bp A/1), once per product
  const first = L.scoped[0]?.p.id;
  useEffect(() => {
    if (L.ui.autoOpened || !first) return;
    const go = tab === 'triage' && packs && window.innerWidth > AUTO_OPEN_MIN_W;
    setLedger((u) => ({ ...u, autoOpened: true, ...(go && !u.open && !u.focus ? { focus: first, open: first } : {}) }));
  }, [first, tab, packs, L.ui.autoOpened]);

  // the row the keys walked to stays in view (J/K, a matrix row)
  const focusId = L.ui.focus;
  useEffect(() => {
    if (!focusId) return;
    root.current?.querySelector<HTMLElement>('[data-fid="' + focusId.replace(/"/g, '') + '"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [focusId]);

  const view = tab === 'release' ? <ReleaseView /> : tab === 'matrix' ? <Matrix L={L} acts={acts} /> : packs ? <PackTable L={L} acts={acts} /> : <Triage L={L} acts={acts} />;
  const bar = tab === 'release' ? null : packs ? <DecisionBar L={L} acts={acts} /> : <DispatchBar L={L} acts={acts} />;
  const names: Record<LedgerTab, string> = { triage: B.lg_tab_triage, matrix: B.lg_tab_matrix, release: B.lg_tab_release };
  const pkg = L.items.filter((f) => f.status === 'accepted' && !f.p.release_id).length;
  const tabs = (
    <div className="lg-tabs" role="tablist" aria-label={B.lg_tabs}>
      {LEDGER_TABS.map((k, i) => (
        <Press key={k} role="tab" id={'bp-lg-tab-' + k} aria-selected={tab === k} aria-controls="bp-lg-panel" tone={tab === k ? 'on' : undefined} onClick={() => setTab(k)} data-testid={'blueprint-ledger-tab-' + k}>
          {names[k]}{k === 'release' && pkg ? ' · ' + pkg : ''}<kbd>{i + 1}</kbd>
        </Press>
      ))}
    </div>
  );
  return (
    <section ref={root} className={'lg-page' + (cmpOpen && wide ? ' wide' : '')} aria-labelledby="bp-ledger-title" tabIndex={-1} data-testid="blueprint-ledger" data-tab={tab} data-scope={scope}>
      <LedgerHead L={L} tabs={tabs} />
      {tab !== 'release' ? <Filters L={L} filter={filter} /> : null}
      <div className="lg-main">
        <div className="lg-body" role="tabpanel" id="bp-lg-panel" aria-labelledby={'bp-lg-tab-' + tab}>{view}</div>
        {cmpOpen && open ? (
          <ComparePanel id={open} ledger={{
            view: L.ui.cmp, wide, order: L.scoped.map((f) => f.p.id),
            onView: (v) => setLedger((u) => ({ ...u, cmp: v })),
            onWide: () => setLedger((u) => ({ ...u, wide: !u.wide })),
            onClose: () => setLedger((u) => ({ ...u, open: null, wide: false })),
            onGo: (id) => setLedger((u) => ({ ...u, open: id, focus: id })),
            onMove: (move) => acts.triage(move, [open]),
          }} />
        ) : null}
      </div>
      {bar}
    </section>
  );
}

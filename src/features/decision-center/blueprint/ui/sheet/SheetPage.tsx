import { useEffect, useMemo, useRef, type Ref } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { ComparePanel } from '../compare/ComparePanel';
import { GeneralTab } from '../page/General';
import { LensTab } from '../page/LensTab';
import { CountMemo, EnterDelay } from '../page/motion';
import { PackBox, ScanBox, useFeatureWork } from '../page/Work';
import { SheetHead } from './SheetHead';
import { SheetTabs } from './SheetTabs';

/**
 * The page inside the morphing box (bp FeatureSheet Page): the sticky head, then the chosen tab in a scroller that
 * returns to the top on every tab switch, sections entering in sequence and numbers counting from what they last
 * showed. The first tab waits for the morph's tail (`enter` seconds); later switches enter at once. With a built item
 * in the compare panel (WP4b, embedded as it is) the body splits: the feature's work beside the compare, each
 * scrolling on its own, where Y, R, S and U triage it while its evidence is in view.
 */
export function SheetPage({ fid, enter, closeRef }: { fid: string; enter: number; closeRef?: Ref<HTMLButtonElement> }) {
  const s = useSheet();
  const sl = s.ui.sheetLens;
  const memo = useMemo(() => new Map<string, number>(), []);
  const scroll = useRef<HTMLDivElement>(null), first = useRef(true);
  const delay = first.current ? enter : 0;
  useEffect(() => { first.current = false; }, []);
  useEffect(() => { scroll.current?.scrollTo?.({ top: 0 }); }, [sl, fid]);
  const { packed, rest } = useFeatureWork(fid, sl);
  const T = s.plan.L.TILE[fid];
  if (!T) return null;
  const cmp = s.ui.compare && s.work.byId.get(s.ui.compare)?.fid === fid ? s.ui.compare : null;
  const isLens = !!s.plan.LENS[sl];
  return (
    <CountMemo.Provider value={memo}>
      <SheetHead fid={fid} closeRef={closeRef} tabs={<div className="pg-tabs" role="tablist" aria-label={s.text.B.pg_tabs_label}><SheetTabs f={T.f} /></div>} />
      {cmp ? (
        <div className="pg-cmpgrid" role="tabpanel" id="bp-sheet-panel" aria-labelledby={'bp-tab-' + sl}>
          <div className="pg-cmpwork"><PackBox packed={packed} /><ScanBox rest={rest} lens={sl} /></div>
          <ComparePanel id={cmp} />
        </div>
      ) : (
        <div className="pg-scroll" ref={scroll} tabIndex={-1}>
          <EnterDelay.Provider value={delay}>
            <div className="pg-body" key={sl + '|' + fid} id="bp-sheet-panel" role="tabpanel" aria-labelledby={'bp-tab-' + sl}>
              {isLens ? <LensTab lens={sl} f={T.f} /> : <GeneralTab f={T.f} />}
            </div>
          </EnterDelay.Provider>
        </div>
      )}
    </CountMemo.Provider>
  );
}

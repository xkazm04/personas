/**
 * WP12 variant 1 - THREE PLATES, RE-ANATOMISED. Today's geometry kept (projects,
 * the thread, a right rail), every part redrawn in the house language:
 *   left    the projects in the Stewards row grammar
 *   centre  the thread, outcome first; the run waiting on the operator says
 *           so in its eyebrow and points at the rail
 *   right   NEEDS YOU: the deck's card head for the ask in hand (stacked
 *           outcome pair), the rest of the project's asks as lane peek rows,
 *           and the deck's fixed verdict dock at the rail's foot. Reviews and
 *           held questions are ONE queue (today: two tabs, Reviews and Quick).
 *           Drive turns the rail to the deliberation's controls (the tab stays).
 */
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { Engraved, Lamp } from '@/features/fleet/monitor/grid/prototype/entry-e/parts';
import { Keycap } from '@/features/decision-center/deck/parts';
import { AskDock, AskHead, AskRow } from './conversationVariantsDeck';
import { Composer } from './conversationVariantsBands';
import { ASKS, COPY, fill } from './conversationVariantsData';
import { Frame, ThreadRows, ThreadScroll } from './conversationVariantsFrame';
import { DriveControls } from './conversationVariantsDrive';
import { ProjectsPlate } from './conversationVariantsRail';

function NeedsYouRail({ drive }: { drive: boolean }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'asks' | 'drive'>(drive ? 'drive' : 'asks');
  const [focus, setFocus] = useState(0);
  const ask = ASKS[focus]!;
  const tabs = [
    { id: 'asks' as const, label: <><Lamp lamp={{ tone: 'warn', lit: true }} />{COPY.needsYou}<span className="typo-data tabular-nums"><Numeric value={ASKS.length} /></span></> },
    { id: 'drive' as const, label: t.monitor.conv_tab_deliberation },
  ];
  return (
    <section className="au-scope ae-plate flex h-full min-h-0 flex-col overflow-hidden rounded-card" data-testid="cv-v1-rail">
      <div className="flex h-11 flex-shrink-0 items-center gap-1 border-b border-border px-2">
        <SegmentedTabs tabs={tabs} activeTab={tab} onTabChange={setTab} variant="pill" size="sm" fullWidth={false} ariaLabel={t.monitor.conv_title} idPrefix="cv-v1-rail" className="border-0 bg-transparent" />
      </div>
      {tab === 'drive' ? <div className="min-h-0 flex-1 overflow-y-auto p-3"><DriveControls /></div> : (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <div className="-mb-1 flex items-center gap-1">
              <span className="flex-1" />
              <span className="typo-caption tabular-nums">{fill(COPY.ofTotal, { n: focus + 1, total: ASKS.length })}</span>
              <Button variant="ghost" size="icon-sm" aria-label={COPY.prev} onClick={() => setFocus((f) => Math.max(0, f - 1))}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={COPY.next} onClick={() => setFocus((f) => Math.min(ASKS.length - 1, f + 1))}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
            </div>
            <AskHead ask={ask} stacked />
            <div>
              <div className="flex items-center gap-2 px-1 pb-1">
                <Engraved>{COPY.needsYou}</Engraved>
                <span className="flex-1" />
                <span className="flex items-center gap-1 typo-caption"><Keycap>J</Keycap><Keycap>K</Keycap> {COPY.walk}</span>
              </div>
              <div className="space-y-1">
                {ASKS.map((a, i) => i === focus ? null : <AskRow key={a.id} ask={a} onFocus={() => setFocus(i)} />)}
              </div>
            </div>
          </div>
          <div className="au-rail-foot flex-shrink-0 p-3"><AskDock ask={ask} /></div>
        </>
      )}
    </section>
  );
}

export function VariantOne({ drive = false }: { drive?: boolean }) {
  const [active, setActive] = useState('t-personas-desktop');
  return (
    <Frame>
      <div className="w-[304px] flex-shrink-0 min-h-0"><ProjectsPlate active={active} onSelect={setActive} /></div>
      <section className="ae-plate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card">
        <ThreadScroll className="px-3 py-1"><ThreadRows /></ThreadScroll>
        <Composer team="Personas Desktop" />
      </section>
      <div className="w-[380px] flex-shrink-0 min-h-0"><NeedsYouRail drive={drive} /></div>
    </Frame>
  );
}


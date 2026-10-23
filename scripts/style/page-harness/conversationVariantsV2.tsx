/**
 * WP12 variant 2 - THE THREAD AND AN INLINE DECISION STRIP, NO RIGHT RAIL.
 *   left    the projects in the Stewards row grammar
 *   centre  the thread at full width, outcome first. Every ask lives where it
 *           was raised: the held publish step inside its run band as the
 *           deck's card head (the outcome pair side by side), the merge under
 *           PR Reviewer's line, the triage close under the settled run, the
 *           held question under the line it answers. Each is a lane peek row
 *           until it is the one in hand.
 *   foot    the deck's FIXED verdict dock, docked above the composer: the ask
 *           in hand (title, 1 of 4, J/K walks the thread's asks in order) and
 *           its verdict pair with the keys inside the buttons, its branch, Later.
 *           Deliberation controls fold open inside the deliberation band (Drive).
 */
import { useState } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Engraved, Lamp } from '@/features/fleet/monitor/grid/prototype/entry-e/parts';
import { Keycap } from '@/features/decision-center/deck/parts';
import { AskDock, AskHead, AskRow } from './conversationVariantsDeck';
import { Composer } from './conversationVariantsBands';
import { ASKS, COPY, fill, type ThreadRow } from './conversationVariantsData';
import { Frame, ThreadRows, ThreadScroll } from './conversationVariantsFrame';
import { DriveControls } from './conversationVariantsDrive';
import { ProjectsPlate } from './conversationVariantsRail';

/** Which ask hangs under which row: its source line, by id. */
const ANCHOR: Record<string, string> = {
  'asg-live': 'rv-roof-1', 'rc-12': 'rv-wp12-2', 'asg-done': 'rv-wp12-3', 'rc-q': 'q-wp12-1',
};

function DecisionStrip({ focus }: { focus: number }) {
  const ask = ASKS[focus]!;
  return (
    <div className="au-scope flex-shrink-0 border-t border-border bg-secondary/20 px-3 pb-2 pt-2" data-testid="cv-v2-strip">
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <Lamp lamp={{ tone: 'warn', lit: true }} />
        <Engraved>{COPY.needsYou}</Engraved>
        <span className="typo-data tabular-nums text-status-warning"><Numeric value={ASKS.length} /></span>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <span className="min-w-0 flex-1 truncate typo-heading text-foreground">{ask.title}</span>
      </div>
      <div className="flex items-center gap-4">
        <AskDock ask={ask} inline />
        <span className="flex-1" />
        <span className="typo-caption tabular-nums">{fill(COPY.ofTotal, { n: focus + 1, total: ASKS.length })}</span>
        <span className="flex items-center gap-1 typo-caption"><Keycap>J</Keycap><Keycap>K</Keycap> {COPY.walk}</span>
      </div>
    </div>
  );
}

export function VariantTwo({ drive = false }: { drive?: boolean }) {
  const [active, setActive] = useState('t-personas-desktop');
  const [focus, setFocus] = useState(0);
  const slot = (row: ThreadRow) => {
    if (drive && row.kind === 'delib') {
      return <div className="ae-well -mt-2 mb-2 rounded-b-card border border-t-0 border-border px-4 py-3"><DriveControls /></div>;
    }
    const id = 'id' in row ? ANCHOR[row.id] : undefined;
    const i = ASKS.findIndex((a) => a.id === id);
    if (i < 0) return null;
    const ask = ASKS[i]!;
    if (i === focus) {
      return (
        <div className="au-scope au-row au-tier-1 border-t border-status-warning/25 px-3 py-2.5" data-focused="" data-cv-focus="">
          <AskHead ask={ask} body={false} />
        </div>
      );
    }
    return <div className="au-scope py-1 pl-8">{<AskRow ask={ask} onFocus={() => setFocus(i)} />}</div>;
  };
  return (
    <Frame>
      <div className="w-[304px] flex-shrink-0 min-h-0"><ProjectsPlate active={active} onSelect={setActive} /></div>
      <section className="ae-plate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card">
        <ThreadScroll className="px-4 py-1" anchor="[data-cv-focus]">
          <div className="mx-auto max-w-[68rem]">
            <ThreadRows slot={slot} />
          </div>
        </ThreadScroll>
        <DecisionStrip focus={focus} />
        <Composer team="Personas Desktop" />
      </section>
    </Frame>
  );
}

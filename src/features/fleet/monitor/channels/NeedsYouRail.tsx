import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { Keycap } from '@/features/decision-center/deck/parts';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { Engraved } from '../grid/prototype/entry-e/parts';
import { AskDock } from './AskDock';
import { AskHead } from './AskHead';
import { AskRow } from './AskRow';
import { askCopy } from './askCopy';
import type { Ask } from './needsYouModel';
import type { NeedsYou } from './useNeedsYou';

/* ----------------------------------------------------------------------------
 * NEEDS YOU - the right rail as ONE queue (WP12 Phase B, the owner's V1).
 *
 * Three bands, and only the middle one scrolls: the ASK IN HAND on top (the
 * deck's card head with "If you approve / If you reject", the n of N walk),
 * the rest of the queue as one-line peek rows, and the deck's fixed verdict
 * dock at the foot. At 1280x800 the head and the dock always stay on screen;
 * the queue gives way. Loading is a ghost, a failed read says so above
 * whatever did load, an empty queue says nothing waits.
 * -------------------------------------------------------------------------- */

function HandHead({ ask, ny }: { ask: Ask; ny: NeedsYou }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const who = usePersonaIndex().get(ask.personaId)?.name.replace(/^T:\s*/, '') ?? '';
  const copy = askCopy(m, ask);
  const tier = ask.tier === 1 ? m.dc_hub_tier_blocking : m.dc_hub_tier_decide;
  return (
    <AskHead
      aside={(
        <>
          <span className="pr-1 typo-caption tabular-nums"><Numeric value={ny.index + 1} /> {tx(m.dc_deck_position, { total: ny.total })}</span>
          <Button variant="ghost" size="icon-sm" aria-label={m.quick_prev_decision} onClick={() => ny.walk(-1)} disabled={ny.total < 2}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={m.quick_next_decision} onClick={() => ny.walk(1)} disabled={ny.total < 2}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        </>
      )}
      kind={copy.kind}
      tier={ask.tier}
      title={ask.title}
      context={<>{tier} · {tx(m.cv_from, { name: who })}{ask.at && <> · <RelativeTime timestamp={ask.at} /></>}</>}
      body={ask.kind === 'review' ? ask.body : null}
      outcomes={copy.outcomes}
    />
  );
}

export function NeedsYouRail({ asks, ny, loading, error, onRetry }: {
  asks: readonly Ask[];
  ny: NeedsYou;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const rest = asks.filter((a) => a.id !== ny.ask?.id);

  if (!ny.ask) {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="needs-you-rail">
        {error && <InlineErrorBanner severity="error" message={m.reviews_error} onRetry={onRetry} compact />}
        {loading && !error ? (
          <div className="space-y-2" aria-busy="true" aria-label={m.reviews_loading}>
            {[0, 1].map((i) => <div key={i} aria-hidden className="ae-ghost h-16 rounded-card" />)}
          </div>
        ) : !error && <p className="ae-well rounded-card px-3 py-5 text-center typo-body">{m.reviews_empty}</p>}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="needs-you-rail">
      <div className="flex-shrink-0 px-3 pb-2 pt-2">
        {error && <div className="mb-2"><InlineErrorBanner severity="error" message={m.reviews_error} onRetry={onRetry} compact /></div>}
        <HandHead ask={ny.ask} ny={ny} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <div className="flex flex-shrink-0 items-center gap-2 px-3 pb-0.5 pt-2">
          <Engraved className="min-w-0 flex-1 truncate">{m.cv_needs_you}</Engraved>
          <span className="flex items-center gap-1 typo-caption"><Keycap>J</Keycap><Keycap>K</Keycap> {m.cv_walk}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" aria-label={m.cv_needs_you}>
          {rest.length > 0
            ? rest.map((a) => <AskRow key={a.id} ask={a} onFocus={ny.focus} />)
            : <p className="px-2 py-1.5 typo-caption">{m.cv_all_clear}</p>}
        </div>
      </div>
      <div className="au-rail-foot flex-shrink-0 p-3"><AskDock ny={ny} /></div>
    </div>
  );
}

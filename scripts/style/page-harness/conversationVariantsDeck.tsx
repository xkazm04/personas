/**
 * WP12 variants: a held review or question in the Decision Deck's anatomy,
 * so deciding one in Conversations is the same gesture as in the deck:
 *   AskHead     eyebrow (GATES · REVIEW) with the tier lamp, the ask as the
 *               title, one context line, then the outcome pair ("If you
 *               approve: ..." lit beside "If you reject: ..." quiet), the
 *               markup of `deck/CardHeader.tsx` OutcomeBand
 *   AskDock     the fixed verdict dock: the deck's own `Verdict` pair with the
 *               key printed inside each button (A / R), the item's branches
 *               (a suggested action, a question's options) as `Branch` rows
 *               with digits, and `Later` (S), from `deck/DeckDock.tsx`
 *   AskRow      the lane peek's row (`hub/visual/PeekRow.tsx`): tier stripe,
 *               title, who and when, the keys once on the focused row
 * No raw coloured Reject/Approve buttons anywhere.
 */
import { Check, Clock, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { useTranslation } from '@/i18n/useTranslation';
import { Branch, Later, Verdict } from '@/features/decision-center/deck/DeckDock';
import { Keycap, Lamp } from '@/features/decision-center/deck/parts';
import { tierLabel } from '@/features/decision-center/deck/deckMeta';
import '@/features/decision-center/deck/aurora.css';
import { COPY, fill, type AskFixture } from './conversationVariantsData';

const TIER_LAMP = { 1: 'danger', 2: 'accent', 3: 'neutral' } as const;
const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export function usePersonaName(id: string): string {
  return usePersonaIndex().get(id)?.name ?? id;
}

function OutcomeBand({ side, verb, effect }: { side: 'yes' | 'no'; verb: string; effect: string }) {
  const { t, tx } = useTranslation();
  return (
    <p className={`au-l-${side === 'yes' ? 'success' : 'neutral'} au-${side} flex min-w-0 flex-col gap-0.5 rounded-r-input py-1.5 pl-3 pr-3`}>
      <span className={`${side === 'yes' ? 'au-ink-lamp' : 'text-foreground'} typo-label`}>{tx(t.monitor.dc_deck_if_you, { verb })}</span>
      <span className="min-w-0 typo-body text-foreground [text-wrap:pretty]">{effect}</span>
    </p>
  );
}

export function OutcomePair({ ask, stacked = false }: { ask: AskFixture; stacked?: boolean }) {
  return (
    <div className={`grid gap-2 ${stacked ? 'grid-cols-1' : 'grid-cols-2'}`}>
      <OutcomeBand side="yes" verb={ask.accept.toLowerCase()} effect={ask.yes} />
      <OutcomeBand side="no" verb={ask.reject.toLowerCase()} effect={ask.no} />
    </div>
  );
}

/** The card head, sized for a plate (title at heading, not the modal's heading-lg). */
export function AskHead({ ask, stacked = false, body = true }: { ask: AskFixture; stacked?: boolean; body?: boolean }) {
  const { t } = useTranslation();
  const who = usePersonaName(ask.personaId);
  const tierWord = tierLabel(t.monitor, ask.tier);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <span className="typo-eyebrow text-primary">{COPY.gates}</span>
        <span className="typo-eyebrow text-foreground" aria-hidden>·</span>
        <span className="typo-eyebrow text-foreground">{ask.kind === 'review' ? COPY.review : COPY.question}</span>
        <Lamp tone={TIER_LAMP[ask.tier]} breathe={ask.tier === 1} />
      </span>
      <span className="typo-heading text-foreground [text-wrap:balance]">{ask.title}</span>
      <span className="typo-caption">{tierWord} · {fill(COPY.from, { name: who })} · <RelativeTime timestamp={at(ask.minutes)} /></span>
      {body && <span className="typo-body text-foreground">{ask.body}</span>}
      <div className="mt-1"><OutcomePair ask={ask} stacked={stacked} /></div>
    </div>
  );
}

/** The fixed verdict dock for the ask in hand. `inline` lays the pair beside Later on one row. */
export function AskDock({ ask, inline = false }: { ask: AskFixture; inline?: boolean }) {
  const noop = () => undefined;
  const check = <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />;
  const cross = <X className="h-4 w-4" strokeWidth={2.5} aria-hidden />;
  const pair = ask.options ? null : (
    <div className={`grid min-w-0 grid-cols-2 gap-2 ${inline ? 'w-[22rem] flex-none' : ''}`}>
      <Verdict k="A" label={ask.accept} yes tone="success" icon={check} pair onClick={noop} />
      <Verdict k="R" label={ask.reject} yes={false} tone="danger" icon={cross} pair onClick={noop} />
    </div>
  );
  const branches = ask.options
    ? ask.options.map((o, i) => <Branch key={o} k={String(i + 1)} label={o} onClick={noop} />)
    : ask.branch ? [<Branch key="b" k="1" label={ask.branch} accent onClick={noop} />] : [];
  if (inline) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {pair ?? <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">{branches}</div>}
        {pair && branches.length > 0 && <div className="w-72 flex-shrink-0">{branches}</div>}
        <Later label={COPY.later} onSkip={noop} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {pair}
      {branches}
      <Later label={COPY.later} onSkip={noop} />
    </div>
  );
}

/** One ask as a lane peek row. */
export function AskRow({ ask, focused = false, onFocus }: { ask: AskFixture; focused?: boolean; onFocus?: () => void }) {
  const persona = usePersonaIndex().get(ask.personaId);
  return (
    <div className={`au-row au-tier-${ask.tier} relative flex items-stretch gap-3 rounded-card py-1 pl-1.5 pr-2`} data-focused={focused ? '' : undefined}>
      <span className="au-stripe flex-shrink-0" aria-hidden />
      <Button
        variant="ghost"
        size="sm"
        onClick={onFocus}
        className="min-w-0 flex-1 rounded-card px-0 py-1.5 text-left hover:bg-transparent [&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>span]:flex-col [&>span]:gap-1"
      >
        <span className="line-clamp-2 typo-body text-foreground [text-wrap:pretty]">{ask.title}</span>
        <span className="flex min-w-0 items-center gap-3 typo-caption">
          <span className="flex min-w-0 items-center gap-1.5">
            {persona && <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="sm" />}
            <span className="truncate">{persona?.name}</span>
          </span>
          <span className="flex flex-shrink-0 items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <RelativeTime timestamp={at(ask.minutes)} className="typo-caption" />
          </span>
        </span>
      </Button>
      {focused && (
        <span className="flex flex-shrink-0 items-center gap-1 text-foreground">
          {ask.options ? <Keycap>1-3</Keycap> : <><Keycap className="text-status-success">A</Keycap><Keycap className="text-status-error">R</Keycap></>}
        </span>
      )}
    </div>
  );
}

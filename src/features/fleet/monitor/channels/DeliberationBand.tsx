import { memo, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { PersonaStack, usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { memberColor } from '@/lib/channel/eventModel';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';
import { Engraved, Lamp } from '../grid/prototype/entry-e/parts';
import { deliberationLeaning, deliberationLook, deliberationStatusLabel } from './deliberationStatus';

/* ----------------------------------------------------------------------------
 * DELIBERATION BAND - a team deciding something, OUTCOME FIRST (WP12).
 *
 * Line 1: the lamp, "DELIBERATION · <status> · ROUND n" engraved, the spend
 * meter (the plates' `ae-bar`) with spent / budget, the voices and when. The
 * title is what the team is leaning to (the converged proposal, else the
 * newest turn); the caption names the topic and the turn count. Drive sends
 * the deliberation's controls to the rail; the chevron folds the turns open.
 * Two buttons side by side, never one inside the other.
 * -------------------------------------------------------------------------- */

export const DeliberationBand = memo(function DeliberationBand({
  deliberation, deliberationId, items, expanded, rowKey, onToggle, onFocus, driving = false,
}: {
  deliberation: TeamDeliberation | undefined;
  deliberationId: string;
  items: TeamChannelItem[];
  expanded: boolean;
  rowKey: string;
  onToggle: (key: string) => void;
  /** Send this deliberation's CONTROLS to the rail (Drive). */
  onFocus: (deliberationId: string) => void;
  driving?: boolean;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const personaIndex = usePersonaIndex();
  const status = deliberation?.status ?? 'open';
  const round = Number(deliberation?.round ?? 0);
  const spent = Number(deliberation?.costSpentUsd ?? 0);
  const budget = Number(deliberation?.costBudgetUsd ?? 5);
  const share = budget > 0 ? Math.min(1, spent / budget) : 0;
  const look = deliberationLook(status);
  const voices = useMemo(() => items.map((i) => i.personaId), [items]);
  const leaning = deliberationLeaning(deliberation, items[items.length - 1]?.body);
  const topic = deliberation?.topic ?? m.conv_card_deliberation;

  return (
    <div className={`ae-win my-2 overflow-hidden rounded-card ${look.win}`} data-testid="conv-deliberation">
      <div className="flex items-start gap-2 px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggle(rowKey)}
          aria-expanded={expanded}
          className="min-w-0 flex-1 justify-start! px-0! py-0! text-left hover:bg-transparent [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-1"
        >
          <span className="flex w-full min-w-0 items-center gap-2">
            <Lamp lamp={look.lamp} />
            <Engraved className="min-w-0 flex-1 truncate">
              {m.conv_card_deliberation} · {deliberationStatusLabel(t, status)} · {tx(m.delib_round, { round })}
            </Engraved>
            <span className={`ae-bar ${share > 0.8 ? 'ae-t-warn' : 'ae-t-agent'} w-16 flex-shrink-0`} aria-hidden><i style={{ width: `${share * 100}%` }} /></span>
            <span className="typo-data tabular-nums text-foreground">
              <Numeric value={spent} precision={2} /> / <Numeric value={budget} precision={2} />
            </span>
            <PersonaStack ids={voices} index={personaIndex} />
            <span className="typo-caption"><RelativeTime timestamp={items[items.length - 1]!.at} /></span>
          </span>
          <span className="line-clamp-2 typo-heading text-foreground [text-wrap:pretty]">
            {leaning ? <><span className="typo-label text-role-agent">{m.cv_leaning}: </span>{leaning}</> : topic}
          </span>
          <span className="truncate typo-caption">{leaning ? `${topic} · ` : ''}{tx(m.cv_turns, { count: items.length })}</span>
        </Button>
        <Button variant="accent" tone="agent" size="xs" onClick={() => onFocus(deliberationId)} aria-pressed={driving} className="flex-shrink-0" data-testid="conv-drive">
          {m.conv_drive}
        </Button>
        <ChevronDown className={`mt-1 h-4 w-4 flex-shrink-0 text-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
      </div>
      <Collapse open={expanded} unmountWhenClosed duration={180}>
        <div className="space-y-1.5 border-t border-border px-3 py-2">
          {items.map((turn) => {
            const persona = turn.personaId ? personaIndex.get(turn.personaId) : undefined;
            return (
              <p key={turn.id} className="whitespace-pre-wrap typo-body text-foreground">
                <span className="typo-label" style={{ color: memberColor(persona, turn.personaId) }}>
                  {persona?.name.replace(/^T:\s*/, '') ?? turn.label}{' '}
                </span>
                {turn.body}
              </p>
            );
          })}
        </div>
      </Collapse>
    </div>
  );
});

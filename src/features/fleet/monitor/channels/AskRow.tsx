import { memo } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import type { Ask } from './needsYouModel';

/**
 * One ask waiting behind the one in hand: the lane peek's row (`hub/visual/
 * PeekRow.tsx`, `.au-row` + the tier stripe) in a COMPACT ONE-LINE form, so
 * the queue under the head stays readable at 1280x800: the asker's glyph, the
 * ask, and how long it has waited. Pressing it brings it into hand.
 */
export const AskRow = memo(function AskRow({ ask, onFocus }: { ask: Ask; onFocus: (id: string) => void }) {
  const persona = usePersonaIndex().get(ask.personaId);
  return (
    <div className={`au-row au-tier-${ask.tier} relative flex items-stretch gap-2 rounded-card py-0.5 pl-1.5 pr-1`} data-testid="ask-row">
      <span className="au-stripe my-1 flex-shrink-0" aria-hidden />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onFocus(ask.id)}
        className="min-w-0 flex-1 rounded-card px-0! py-1 text-left hover:bg-transparent [&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>span]:items-center [&>span]:gap-2"
      >
        {persona && <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="sm" />}
        <span className="min-w-0 flex-1 truncate typo-body text-foreground">{ask.title}</span>
        {ask.at && <RelativeTime timestamp={ask.at} className="flex-shrink-0 typo-caption" />}
      </Button>
    </div>
  );
});

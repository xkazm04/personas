import { memo } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { usePipelineStore } from '@/stores/pipelineStore';
import { countPersonaUnread, readPersonaLastSeen } from '@/stores/slices/pipeline/personaChannelSlice';
import type { Persona } from '@/lib/bindings/Persona';
import { Lamp } from '../grid/prototype/entry-e/parts';
import { Figure } from './ProjectRow';

/**
 * A persona conversation in the projects plate (W5), on the project row's
 * grid: the persona's own glyph tile instead of the colour edge, the name,
 * then NEW and YOU under the same column heads and the same lamp. The row is
 * driven by a one-row preview read (an empty channel never renders a row);
 * once the conversation has been opened its full state upgrades the unread
 * figure from "1" to the real count. The last line's time is in the tooltip.
 */
export const PersonaThreadRow = memo(function PersonaThreadRow({ persona, active, onSelect, asks }: {
  persona: Persona;
  active: boolean;
  onSelect: (personaId: string) => void;
  asks: number | null;
}) {
  const preview = usePipelineStore((s) => s.personaChannelPreviews[persona.id]);
  const st = usePipelineStore((s) => s.personaChannels[persona.id]);
  const newest = st?.items[0] ?? preview;
  let unread = 0;
  if (st?.loaded) {
    unread = countPersonaUnread(st);
  } else if (preview && !(preview.kind === 'chat' && preview.authorKind === 'user')) {
    const seen = readPersonaLastSeen(persona.id);
    if (seen === null || preview.at > seen) unread = 1;
  }
  const name = persona.name.replace(/^T:\s*/, '');

  return (
    <Tooltip placement="right" delay={400} content={newest ? <span className="typo-caption"><RelativeTime timestamp={newest.at} /></span> : name}>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => onSelect(persona.id)}
        aria-current={active}
        data-testid="conv-persona-row"
        className={`ae-plan ae-focus ${active ? 'is-open' : ''}`}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="sm" />
          <span className={`min-w-0 flex-1 truncate typo-body ${active ? 'text-primary' : 'text-foreground'}`}>{name}</span>
          <Figure n={unread} />
          <Figure n={asks} warn />
          <Lamp lamp={{ tone: 'warn', lit: asks !== null && asks > 0 }} />
        </span>
      </Button>
    </Tooltip>
  );
});

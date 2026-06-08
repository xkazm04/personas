import { useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import { useRedRoomFeed } from './useRedRoomFeed';
import { RedRoomTranscript } from './RedRoomTranscript';
import { RedRoomRelay } from './RedRoomRelay';
import type { StudioMember } from '../sub_teamWorkspace/teamStudio/useTeamStudioData';

/**
 * Red Room — the team's communication channel.
 *
 * v1 is READ-ONLY and composed entirely from existing data: the persona-event
 * bus (what members emitted), event subscriptions (who listens = who the
 * message is addressed to) and team memories (the channel's pinned knowledge).
 * No new backend; the room makes the orchestration traffic legible.
 *
 * PROTOTYPE SCAFFOLD (temporary): two directional variants behind a tab
 * switcher — Transcript (mission radio log) / Relay (handoff
 * edges + shared-memory rail); Channel was pruned in round 2. Consolidated once a winner is
 * declared.
 */

type RedRoomVariant = 'transcript' | 'relay';

const VARIANT_TABS: Array<{ id: RedRoomVariant; label: string; hint: string }> = [
  { id: 'transcript', label: 'Transcript', hint: 'Dense mission radio log with family filters' },
  { id: 'relay', label: 'Relay', hint: 'Handoff edges (who→what→whom) + shared-memory rail' },
];

export function RedRoomPane({ teamId, members }: { teamId: string; members: StudioMember[] }) {
  const memberPersonaIds = useMemo(() => members.map((m) => m.personaId), [members]);
  const { items, loaded, projectId } = useRedRoomFeed(teamId, memberPersonaIds);
  const [variant, setVariant] = useState<RedRoomVariant>('transcript');

  return (
    <div className="h-full flex flex-col gap-2 min-h-0" data-testid="red-room">
      {/* Header strip: identity + live stats + variant tabs */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="inline-flex items-center gap-1.5 typo-label uppercase tracking-wider text-red-300/90">
          <Radio className="w-3.5 h-3.5" /> Red room
        </span>
        <span className="typo-caption text-foreground/45">
          {items.length} transmissions{projectId ? '' : ' · no linked project — member-scoped'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {VARIANT_TABS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              title={v.hint}
              className={`px-2.5 py-1 rounded-interactive typo-caption transition-colors ${
                variant === v.id
                  ? 'bg-primary/15 text-foreground font-medium'
                  : 'text-foreground/55 hover:bg-secondary/40 hover:text-foreground/85'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!loaded ? (
          <p className="typo-body text-foreground/45 px-1 py-3">Tuning in…</p>
        ) : variant === 'relay' ? (
          <RedRoomRelay items={items} />
        ) : (
          <RedRoomTranscript items={items} />
        )}
      </div>
    </div>
  );
}

export default RedRoomPane;

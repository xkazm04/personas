import { useMemo } from 'react';
import { Radio } from 'lucide-react';
import { useRedRoomFeed } from './useRedRoomFeed';
import { RedRoomTranscript } from './RedRoomTranscript';
import type { StudioMember } from '../sub_teamWorkspace/teamStudio/useTeamStudioData';

/**
 * Red Room — the team's communication channel.
 *
 * v1 is READ-ONLY and composed entirely from existing data: the persona-event
 * bus (what members emitted), event subscriptions (who listens = who the
 * message is addressed to) and team memories (the channel's pinned knowledge).
 * No new backend; the room makes the orchestration traffic legible.
 *
 * Renders the Transcript (mission radio log) — the /prototype winner. The
 * Channel variant was pruned in round 2 and the Relay (handoff edges +
 * shared-memory rail) was retired at consolidation; listener wiring for
 * unrouted events lives in the Chain Studio ledger.
 */
export function RedRoomPane({ teamId, members }: { teamId: string; members: StudioMember[] }) {
  const memberPersonaIds = useMemo(() => members.map((m) => m.personaId), [members]);
  const { items, loaded, projectId } = useRedRoomFeed(teamId, memberPersonaIds);

  return (
    <div className="h-full flex flex-col gap-2 min-h-0" data-testid="red-room">
      {/* Header strip: identity + live stats */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="inline-flex items-center gap-1.5 typo-label uppercase tracking-wider text-red-300/90">
          {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
          <Radio className="w-3.5 h-3.5" /> Red room
        </span>
        <span className="typo-caption text-foreground">
          {items.length} transmissions{projectId ? '' : ' · no linked project — member-scoped'}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!loaded ? (
          /* eslint-disable-next-line custom/no-hardcoded-jsx-text */
          <p className="typo-body text-foreground px-1 py-3">Tuning in…</p>
        ) : (
          <RedRoomTranscript items={items} />
        )}
      </div>
    </div>
  );
}

export default RedRoomPane;

import { useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { CollabLive } from './CollabLive';
import { CollabVariantC } from './CollabVariantC';
import type { StudioMember } from '../sub_teamWorkspace/teamStudio/useTeamStudioData';

/**
 * Collab — the team's living chat (Design B, production).
 *
 * LIVE is the real surface: server read-model feed (step layer ∪ bus ∪
 * memories), push + poll freshness, presence, and a directive composer with
 * step-boundary delivery receipts. The C mock (dialogue-native orchestration)
 * stays as a tab for the upcoming Director/Athena orchestration design
 * discussion — it is NOT wired to data.
 */

type CollabTab = 'live' | 'dialogue-mock';

const TABS: Array<{ id: CollabTab; label: string; hint: string }> = [
  { id: 'live', label: 'Live', hint: 'Production Design B — real channel + directives with receipts' },
  { id: 'dialogue-mock', label: 'C — Dialogue (mock)', hint: 'Future direction mock, for the Director/Athena design discussion' },
];

export function CollabPane({ teamId, members }: { teamId: string; members: StudioMember[] }) {
  const [tab, setTab] = useState<CollabTab>('live');

  return (
    <div className="h-full flex flex-col gap-2 min-h-0" data-testid="collab-pane">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="inline-flex items-center gap-1.5 typo-label uppercase tracking-wider text-foreground/80">
          <MessagesSquare className="w-3.5 h-3.5" /> Collab
        </span>
        <div className="ml-auto flex items-center gap-1">
          {TABS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setTab(v.id)}
              title={v.hint}
              className={`px-2.5 py-1 rounded-interactive typo-caption transition-colors ${
                tab === v.id
                  ? 'bg-primary/15 text-foreground font-medium'
                  : 'text-foreground/55 hover:bg-secondary/40 hover:text-foreground/85'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'dialogue-mock' ? <CollabVariantC /> : <CollabLive teamId={teamId} members={members} />}
      </div>
    </div>
  );
}

export default CollabPane;

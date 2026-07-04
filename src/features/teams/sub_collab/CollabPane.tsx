import { MessagesSquare } from 'lucide-react';
import { CollabLiveCorrespondence } from './CollabLiveCorrespondence';
import type { StudioMember } from '../sub_teamWorkspace/teamStudio/useTeamStudioData';

/**
 * Collab — the team's living chat (Design B, production).
 *
 * The real surface: server read-model feed (step layer ∪ bus ∪ memories ∪
 * channel messages), push + poll freshness, presence, and a directive composer
 * with step-boundary delivery receipts.
 *
 * Renders Correspondence — the C5 /prototype winner (warm two-row
 * conversation with inline review & failure intervention). The flat-row
 * Baseline and the Dialogue mock were retired at consolidation.
 */
export function CollabPane({ teamId, members }: { teamId: string; members: StudioMember[] }) {
  return (
    <div className="h-full flex flex-col gap-2 min-h-0" data-testid="collab-pane">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="inline-flex items-center gap-1.5 typo-label uppercase tracking-wider text-foreground">
          <MessagesSquare className="w-3.5 h-3.5" /> Collab
        </span>
      </div>

      <div className="flex-1 min-h-0">
        <CollabLiveCorrespondence teamId={teamId} members={members} />
      </div>
    </div>
  );
}

export default CollabPane;

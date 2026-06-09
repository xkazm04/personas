import { useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { CollabLive } from './CollabLive';
import { CollabLiveCorrespondence } from './CollabLiveCorrespondence';
import type { StudioMember } from '../sub_teamWorkspace/teamStudio/useTeamStudioData';

/**
 * Collab — the team's living chat (Design B, production).
 *
 * The real surface: server read-model feed (step layer ∪ bus ∪ memories ∪
 * channel messages), push + poll freshness, presence, and a directive composer
 * with step-boundary delivery receipts.
 *
 * C5 FLAGSHIP-POLISH PROTOTYPE (in progress): Correspondence is the winning
 * direction (default) — a warm two-row conversation (Source + Event / Message)
 * with inline review & failure intervention. Baseline is kept for A/B while the
 * polish loop continues. The Dialogue (C) mock was retired.
 */

type LiveVariant = 'baseline' | 'correspondence';

const LIVE_VARIANTS: Array<{ id: LiveVariant; label: string; hint: string }> = [
  { id: 'correspondence', label: 'Correspondence', hint: 'Warm two-row conversation — Source + Event / Message, inline review' },
  { id: 'baseline', label: 'Baseline', hint: 'Current flat-row channel (A/B reference)' },
];

export function CollabPane({ teamId, members }: { teamId: string; members: StudioMember[] }) {
  const [liveVariant, setLiveVariant] = useState<LiveVariant>('correspondence');

  return (
    <div className="h-full flex flex-col gap-2 min-h-0" data-testid="collab-pane">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="inline-flex items-center gap-1.5 typo-label uppercase tracking-wider text-foreground">
          <MessagesSquare className="w-3.5 h-3.5" /> Collab
        </span>
        {/* C5 prototype variant strip — Correspondence (winner) vs Baseline (A/B) */}
        <div className="ml-auto flex items-center gap-1">
          {LIVE_VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setLiveVariant(v.id)}
              title={v.hint}
              className={`px-2.5 py-1 rounded-interactive typo-caption transition-colors ${
                liveVariant === v.id
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
        {liveVariant === 'baseline' ? (
          <CollabLive teamId={teamId} members={members} />
        ) : (
          <CollabLiveCorrespondence teamId={teamId} members={members} />
        )}
      </div>
    </div>
  );
}

export default CollabPane;

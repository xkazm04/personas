import { useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { CollabVariantA } from './CollabVariantA';
import { CollabVariantB } from './CollabVariantB';
import { CollabVariantC } from './CollabVariantC';

/**
 * Collab — living-chat DESIGN COMPARISON (all mock data).
 *
 * Three end-game prototypes for the "watch the team cooperate + intervene"
 * vision, one per design from the living-chat analysis:
 *   A — Composed Channel: wire existing step events/reviews/memories; honest
 *       next-run directive latency.
 *   B — Read-model + acks: pushed messages, presence, step-boundary delivery
 *       with read-receipts.
 *   C — Dialogue-native: chat-first orchestration, mid-execution interrupts,
 *       plan renegotiated in-thread (the severe redesign).
 *
 * Same mocked SDLC mission in all three so the comparison is purely the
 * experience. Nothing here touches the DB.
 */

type CollabVariant = 'a' | 'b' | 'c';

const TABS: Array<{ id: CollabVariant; label: string; hint: string }> = [
  { id: 'a', label: 'A — Composed', hint: 'Wire-only: existing events + reviews + next-run directives' },
  { id: 'b', label: 'B — Live + acks', hint: 'Read-model + push + step-boundary delivery with receipts' },
  { id: 'c', label: 'C — Dialogue', hint: 'Chat-first orchestration with mid-execution interrupts' },
];

export function CollabPane() {
  const [variant, setVariant] = useState<CollabVariant>('a');

  return (
    <div className="h-full flex flex-col gap-2 min-h-0" data-testid="collab-pane">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="inline-flex items-center gap-1.5 typo-label uppercase tracking-wider text-foreground/80">
          <MessagesSquare className="w-3.5 h-3.5" /> Collab
        </span>
        <span className="typo-caption text-foreground/45">design comparison · mock data</span>
        <div className="ml-auto flex items-center gap-1">
          {TABS.map((v) => (
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

      <div className="flex-1 min-h-0">
        {variant === 'b' ? <CollabVariantB /> : variant === 'c' ? <CollabVariantC /> : <CollabVariantA />}
      </div>
    </div>
  );
}

export default CollabPane;

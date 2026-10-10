import type { ReactNode } from 'react';

import type { DevNote } from '@/lib/bindings/DevNote';

/**
 * One milestone's band in the room. OPTIONAL: the Notepad desk passes none and
 * its room renders exactly the lanes it always had. Goals > Progress passes one
 * per milestone, so a project reads as its plan - each cut with its brief
 * beside its goals - instead of as three status lanes.
 *
 * The room owns the brief's card (it is the same `NoteDeskCard`, with every
 * verb the desk has); the caller owns the header and what sits beside it,
 * because those are the milestone's, not the note's.
 */
export interface QuestMilestoneGroup {
  id: string;
  header: ReactNode;
  /** The milestone's brief note, drawn as the room's own card. */
  brief: DevNote | null;
  /** Drawn in the brief's slot when there is none (a "Start brief" door). */
  emptyBrief?: ReactNode;
  /** Drawn beside the brief: the milestone's goals. */
  aside?: ReactNode;
}

export function QuestRoomBands({
  groups,
  renderCard,
}: {
  groups: readonly QuestMilestoneGroup[];
  renderCard: (note: DevNote, order: number) => ReactNode;
}) {
  return (
    <>
      {groups.map((group, order) => {
        const slot = group.brief ? renderCard(group.brief, order) : group.emptyBrief ?? null;
        return (
          <section
            key={group.id}
            data-testid={`notepad-questlog-band-${group.id}`}
            className="rounded-card border border-primary/10 bg-secondary/10 p-4 flex flex-col gap-3"
          >
            {group.header}
            <div className="grid grid-cols-3 gap-4 items-start">
              {slot !== null && <div className="min-w-0">{slot}</div>}
              {group.aside && <div className={slot !== null ? 'col-span-2 min-w-0' : 'col-span-3 min-w-0'}>{group.aside}</div>}
            </div>
          </section>
        );
      })}
    </>
  );
}

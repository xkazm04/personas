// Contact Sheet — the gallery-first prototype shell of the Contest page.
//
// One metaphor throughout: a contest is a ROLL of film, its variants are
// FRAMES, seats DEVELOP them, the owner reviews on a LIGHTBOX under a LOUPE
// and marks frames with a GREASE PENCIL (✕ ~ ○ ★), and the winner is the KEPT
// PRINT. Layers:
//   home    — the light table: every roll as a contact strip (SheetWall), or
//             the kept prints + seat record + ledger (KeepersView)
//   focus   — the lightbox for one roll: developing trays while it runs,
//             the loupe + filmstrip + trays + decision once frames land
//   setup   — a slide-over "new roll" (SetupForm)
// Focus comes from `focus.ts`, so a live notice opening a roll lands here.
// Takes no props (the page host mounts it).
import { useState } from 'react';
import { Film, Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import {
  SegmentedTabs,
  segmentedTabPanelProps,
  type SegmentedTab,
} from '@/features/shared/components/layout/SegmentedTabs';

import { contestKeyString, focusContest, useContestFocus } from '../../focus';
import { CONTACT_COPY as C } from './copy';
import { KeepersView } from './KeepersView';
import { Lightbox } from './Lightbox';
import { NewRollSlideOver } from './NewRollSlideOver';
import { SheetWall } from './SheetWall';

type ContactView = 'wall' | 'keepers';

const VIEW_TABS: SegmentedTab<ContactView>[] = [
  { id: 'wall', label: C.viewWall, testId: 'contact-view-wall' },
  { id: 'keepers', label: C.viewKeepers, testId: 'contact-view-keepers' },
];

const VIEW_PREFIX = 'contact-view';

export default function ContactSheetShell() {
  const focused = useContestFocus((s) => s.focused);
  const focusSeq = useContestFocus((s) => s.focusSeq);
  const [view, setView] = useState<ContactView>('wall');
  const [newRoll, setNewRoll] = useState(false);
  const [initialFrame, setInitialFrame] = useState<string | null>(null);

  const open = (projectId: string, contestId: string, frameKey?: string) => {
    setInitialFrame(frameKey ?? null);
    focusContest({ projectId, contestId });
  };
  const back = () => {
    setInitialFrame(null);
    focusContest(null);
  };

  return (
    <div className="space-y-4" data-testid="contest-shell-contact">
      <div className="flex flex-wrap items-center gap-3">
        <Film className="w-4 h-4 text-primary" aria-hidden />
        <span className="typo-heading">{C.shellLabel}</span>
        {!focused && (
          <SegmentedTabs
            tabs={VIEW_TABS}
            activeTab={view}
            onTabChange={setView}
            idPrefix={VIEW_PREFIX}
            ariaLabel={C.viewSwitchLabel}
            fullWidth={false}
            size="sm"
          />
        )}
        <Button
          size="sm"
          variant="primary"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setNewRoll(true)}
          className="ml-auto"
          data-testid="contact-new-roll-open"
        >
          {C.newRoll}
        </Button>
      </div>

      {focused ? (
        <Lightbox
          key={`${contestKeyString(focused)}#${focusSeq}`}
          focus={focused}
          initialFrame={initialFrame}
          onBack={back}
        />
      ) : (
        <div
          role="tabpanel"
          id={segmentedTabPanelProps(VIEW_PREFIX, view).id}
          aria-labelledby={segmentedTabPanelProps(VIEW_PREFIX, view)['aria-labelledby']}
        >
          {view === 'wall' ? (
            <SheetWall onOpen={open} onNewRoll={() => setNewRoll(true)} />
          ) : (
            <KeepersView onOpen={open} />
          )}
        </div>
      )}

      <NewRollSlideOver open={newRoll} onClose={() => setNewRoll(false)} defaultProjectId={focused?.projectId ?? null} />
    </div>
  );
}

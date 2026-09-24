/**
 * The overlay's one line of chrome: who is being trained, where in the story
 * they are, the doors off the table, dictation, and the way out.
 *
 * The stage strip arrives as a SLOT from `ExperienceBody`, which renders it
 * beside the region it swaps and declares that region as its `role="tabpanel"`
 * (census `tabstrip-with-no-declared-panel`): a strip whose panel is declared
 * in another file promises a relationship nothing states, and `SegmentedTabs`
 * emits `aria-controls` whether or not a panel answers it.
 *
 * The fields editor used to be the other half of a guide/fields tab strip.
 * It is a DOOR now, like the rest — a second strip in the header made the
 * chrome read as a toolbar, and the editor is a place you visit and come back
 * from, not a mode the table lives in.
 */

import type { ReactNode } from 'react';
import { BookOpenText, Layers, Palette, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { SetupVoiceControls } from '../../setup/SetupVoiceControls';
import type { SetupStage, SetupVoiceApi } from '../../setup/setupContract';
import { EXPERIENCE_TITLE_ID } from '../experienceIds';

/** The layers reachable from the chrome. `fields` is the widest of them. */
export type ExperienceDoor = 'sheet' | 'deck' | 'studio' | 'fields';

interface TableChromeProps {
  title: string;
  stage: SetupStage;
  /** The setup/training strip, rendered by the body beside its own panel. */
  stageTabs: ReactNode;
  voice: SetupVoiceApi;
  openDoor: ExperienceDoor | null;
  onDoor: (door: ExperienceDoor) => void;
  /** True while the voice studio has drafts waiting to be reviewed. */
  studioWaiting: boolean;
  onClose: () => void;
}

function Door({
  id,
  label,
  icon,
  open,
  dot,
  onOpen,
}: {
  id: ExperienceDoor;
  label: string;
  icon: ReactNode;
  open: boolean;
  dot?: boolean;
  onOpen: (door: ExperienceDoor) => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={() => onOpen(id)}
        aria-label={label}
        aria-expanded={open}
        data-open={open}
        data-testid={`twin-experience-door-${id}`}
        className={`focus-ring relative flex items-center justify-center w-8 h-8 rounded-interactive border transition-colors ${
          open ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-transparent hover:bg-secondary/50'
        }`}
      >
        <span aria-hidden>{icon}</span>
        {dot && <span aria-hidden className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-status-warning" />}
      </button>
    </Tooltip>
  );
}

export function TableChrome({
  title,
  stage,
  stageTabs,
  voice,
  openDoor,
  onDoor,
  studioWaiting,
  onClose,
}: TableChromeProps) {
  const { t } = useTranslation();
  const tx = t.twin.experience;

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 py-3 border-b border-primary/15">
      <h1 id={EXPERIENCE_TITLE_ID} className="flex-1 min-w-0 typo-section-title text-foreground truncate">
        {title}
      </h1>

      <div className="flex-shrink-0 w-[13.5rem] hidden md:block">{stageTabs}</div>

      <div className="flex-shrink-0 flex items-center gap-1" role="group" aria-label={tx.table.doors}>
        <Door id="sheet" label={tx.sheet.title} icon={<BookOpenText className="w-4 h-4" />} open={openDoor === 'sheet'} onOpen={onDoor} />
        {stage === 'training' && (
          <Door id="deck" label={tx.deck.title} icon={<Layers className="w-4 h-4" />} open={openDoor === 'deck'} onOpen={onDoor} />
        )}
        <Door
          id="studio"
          label={tx.studio.title}
          icon={<Palette className="w-4 h-4" />}
          open={openDoor === 'studio'}
          dot={studioWaiting}
          onOpen={onDoor}
        />
        <Door
          id="fields"
          label={t.twin.setup.fieldsTitle}
          icon={<SlidersHorizontal className="w-4 h-4" />}
          open={openDoor === 'fields'}
          onOpen={onDoor}
        />
      </div>

      <SetupVoiceControls voice={voice} />

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label={t.common.close}
        data-testid="twin-experience-close"
        icon={<X className="w-4 h-4" />}
      />
    </div>
  );
}

export default TableChrome;

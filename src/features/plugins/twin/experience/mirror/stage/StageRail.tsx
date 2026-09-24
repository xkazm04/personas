/**
 * The lane's only chrome: who is being trained, where in the story they are,
 * and the doors off it. One line, four clusters, nothing else.
 *
 * What is deliberately NOT here: the voice controls (they live on the reply
 * field, where dictation is actually used), the fields editor (it lives inside
 * the sheet, because it is the same subject), and any readout the ring already
 * gives shape to. Chrome that names everything reachable is the failure this
 * variant exists to avoid.
 *
 * Nor is the setup/training strip itself. It arrives as a SLOT from `Stage`,
 * which renders it beside the region it swaps and declares that region as its
 * `role="tabpanel"` (census `tabstrip-with-no-declared-panel`): a strip whose
 * panel is declared in another file promises a relationship nothing states,
 * and `SegmentedTabs` emits `aria-controls` whether or not a panel answers it.
 */

import type { ReactNode } from 'react';
import { BookOpenText, Layers, Palette, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupChecklistItem, SetupStage } from '../../../setup/setupContract';
import { MIRROR_TITLE_ID } from '../mirrorIds';
import { SigilDisc } from '../SigilDisc';
import { ProgressRing } from './ProgressRing';

export type MirrorDoor = 'sheet' | 'deck' | 'voice';

interface StageRailProps {
  name: string;
  pronouns: string | null;
  checklist: SetupChecklistItem[];
  score: number;
  /** Which stage is live — the deck door only exists in training. */
  stage: SetupStage;
  /** The setup/training strip, rendered by `Stage` beside its own panel. */
  stageTabs: ReactNode;
  openDoor: MirrorDoor | null;
  onDoor: (door: MirrorDoor) => void;
  /** True while the voice layer has drafts waiting to be reviewed. */
  voiceWaiting: boolean;
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
  id: MirrorDoor;
  label: string;
  icon: ReactNode;
  open: boolean;
  dot?: boolean;
  onOpen: (door: MirrorDoor) => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={() => onOpen(id)}
        aria-label={label}
        aria-expanded={open}
        data-open={open}
        data-testid={`mr-door-${id}`}
        className="mr-door focus-ring relative flex items-center justify-center w-8 h-8 rounded-interactive text-foreground"
      >
        <span aria-hidden>{icon}</span>
        {dot && (
          <span aria-hidden className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-status-warning" />
        )}
      </button>
    </Tooltip>
  );
}

export function StageRail({
  name,
  pronouns,
  checklist,
  score,
  stage,
  stageTabs,
  openDoor,
  onDoor,
  voiceWaiting,
  onClose,
}: StageRailProps) {
  const { t } = useTranslation();
  const mr = t.twin.experience_mirror;

  return (
    <header className="flex-shrink-0 flex items-center gap-4 px-5 py-2.5 border-b border-primary/10">
      <div className="min-w-0 flex items-center gap-3">
        <ProgressRing checklist={checklist}>
          <SigilDisc pronouns={pronouns} size="sm" shared />
        </ProgressRing>
        <div className="min-w-0">
          <h2 id={MIRROR_TITLE_ID} className="typo-title-lg text-foreground truncate">
            {name}
          </h2>
          <p className="typo-caption flex items-center gap-1.5">
            <Numeric value={Math.round(score)} unit="percent" precision={0} className="typo-data text-foreground" />
            <span>{t.twin.setup.scoreLabel}</span>
          </p>
        </div>
      </div>

      <div className="ml-auto w-[13rem]">{stageTabs}</div>

      <div className="flex items-center gap-1" role="group" aria-label={mr.rail.doors}>
        <Door id="sheet" label={mr.sheet.title} icon={<BookOpenText className="w-4 h-4" />} open={openDoor === 'sheet'} onOpen={onDoor} />
        {stage === 'training' && (
          <Door id="deck" label={mr.deck.title} icon={<Layers className="w-4 h-4" />} open={openDoor === 'deck'} onOpen={onDoor} />
        )}
        <Door
          id="voice"
          label={mr.voice.title}
          icon={<Palette className="w-4 h-4" />}
          open={openDoor === 'voice'}
          dot={voiceWaiting}
          onOpen={onDoor}
        />
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label={t.common.close}
        data-testid="mr-close"
        icon={<X className="w-4 h-4" />}
      />
    </header>
  );
}

export default StageRail;

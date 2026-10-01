/**
 * L3 of the Twin Detail page (spark twin-portable-blueprint): one section's
 * full, read-only detail in a right drawer. The blueprint on L1 and L2 draws
 * quantities; the text behind them lives here. Each section ends with
 * "Edit in setup", which opens the experience at the door that edits it.
 *
 * The shared BaseModal is the drawer (Esc, backdrop, focus trap, portal), so
 * it sits above the page on the key ladder and Escape closes it before the
 * page's own L2 handler ever sees the key. Its exit animation keeps the last
 * section it rendered, so nothing here has to remember it.
 */
import { useId } from 'react';
import { PencilLine } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { KitButton, KitHost, Section, Surface } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { openTwinExperience } from '../experience/launcher';
import type { SectionId, TwinBlueprintModel } from './blueprintContract';
import type { BlueprintSources } from './blueprintModel';
import { IdentityDetail } from './detail/IdentityDetail';
import { KnowledgeDetail } from './detail/KnowledgeDetail';
import { TrainingDetail } from './detail/TrainingDetail';
import { VoiceDetail } from './detail/VoiceDetail';
import { SECTION_DOOR } from './sectionDoors';

/** What L3 shows: a section, optionally opened on one item (a channel, topic or goal). */
export interface DetailTarget {
  section: SectionId;
  itemKey?: string;
}

interface SectionDetailDrawerProps {
  target: DetailTarget | null;
  model: TwinBlueprintModel;
  sources: BlueprintSources;
  onClose: () => void;
}

const BODIES = {
  identity: IdentityDetail,
  voice: VoiceDetail,
  knowledge: KnowledgeDetail,
  training: TrainingDetail,
} as const;

export function SectionDetailDrawer({ target, model, sources, onClose }: SectionDetailDrawerProps) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  const titleId = useId();
  const shown = target;

  const editInSetup = (section: SectionId) => {
    onClose();
    openTwinExperience({ mode: 'train', stage: 'setup', door: SECTION_DOOR[section] });
  };

  const Body = shown ? BODIES[shown.section] : null;

  return (
    <BaseModal isOpen={target !== null} onClose={onClose} titleId={titleId} placement="right-drawer" portal staggerChildren={false}>
      {shown && Body && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto pt-5" data-testid={`twin-detail-drawer-${shown.section}`}>
            <KitHost compact>
              <Surface>
                <Section
                  title={<span id={titleId}>{b.sections[shown.section]}</span>}
                  desc={b.sectionHints[shown.section]}
                  actions={
                    <KitButton tone="quiet" hint="Esc" onClick={onClose} testId="twin-detail-drawer-close">
                      {t.common.close}
                    </KitButton>
                  }
                >
                  <Body model={model} sources={sources} itemKey={shown.itemKey} />
                </Section>
              </Surface>
            </KitHost>
          </div>
          <KitHost compact>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-primary/10">
              <KitButton
                tone="primary"
                icon={<PencilLine />}
                onClick={() => editInSetup(shown.section)}
                testId="twin-detail-edit-in-setup"
              >
                {b.nav.editInSetup}
              </KitButton>
            </div>
          </KitHost>
        </>
      )}
    </BaseModal>
  );
}

export default SectionDetailDrawer;

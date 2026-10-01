/** Dossier (WP9): the glance body of one section (layer one, or compact on a stage rail). */
import type { SectionId } from '../../../blueprintContract';
import type { GlanceProps } from './glanceTypes';
import { IdentityGlance } from './IdentityGlance';
import { KnowledgeGlance } from './KnowledgeGlance';
import { TrainingGlance } from './TrainingGlance';
import { VoiceGlance } from './VoiceGlance';

export function SectionGlance({ section, ...props }: GlanceProps & { section: SectionId }) {
  switch (section) {
    case 'identity':
      return <IdentityGlance {...props} />;
    case 'voice':
      return <VoiceGlance {...props} />;
    case 'knowledge':
      return <KnowledgeGlance {...props} />;
    case 'training':
      return <TrainingGlance {...props} />;
  }
}

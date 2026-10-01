/** Dossier (WP9): the L2 board of one section, the zoomed tile's body. */
import type { SectionId, TwinBlueprintModel } from '../../../blueprintContract';
import { IdentityBoard } from './IdentityBoard';
import { KnowledgeBoard } from './KnowledgeBoard';
import { TrainingBoard } from './TrainingBoard';
import { VoiceBoard } from './VoiceBoard';

interface SectionBoardProps {
  section: SectionId;
  model: TwinBlueprintModel;
  roomy?: boolean;
  onOpenDetail: (section: SectionId, itemKey?: string) => void;
  reduced: boolean;
}

export function SectionBoard({ section, model, roomy, onOpenDetail, reduced }: SectionBoardProps) {
  switch (section) {
    case 'identity':
      return <IdentityBoard model={model} reduced={reduced} />;
    case 'voice':
      return <VoiceBoard channels={model.voice.channels} roomy={roomy} onOpenDetail={onOpenDetail} reduced={reduced} />;
    case 'knowledge':
      return <KnowledgeBoard model={model} reduced={reduced} />;
    case 'training':
      return <TrainingBoard model={model} onOpenDetail={onOpenDetail} reduced={reduced} />;
  }
}

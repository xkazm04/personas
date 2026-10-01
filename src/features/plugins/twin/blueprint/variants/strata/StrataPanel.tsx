/**
 * L2: the content that sits on the lifted plate once it has flattened face-on.
 * The plate itself is the glass behind it (it travels; this fades in after it
 * lands, so the charts are flat, crisp and at full type size). Every item opens
 * L3 through `onOpenDetail`; the page shell owns that drawer.
 */
import { useEffect, useRef } from 'react';
import { ArrowLeft, PanelRightOpen } from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

import type { SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { IdentityDetail } from './detail/IdentityDetail';
import { KnowledgeDetail } from './detail/KnowledgeDetail';
import { TrainingDetail } from './detail/TrainingDetail';
import { VoiceDetail } from './detail/VoiceDetail';
import { StrataFigure } from './StrataFigure';

interface StrataPanelProps {
  section: SectionId;
  model: TwinBlueprintModel;
  coverage: number | null;
  /** Move keyboard focus to Back once mounted (the user opened it from the stack). */
  takeFocus: boolean;
  reduced: boolean;
  onBack: () => void;
  onOpenDetail: (section: SectionId, itemKey?: string) => void;
}

export function StrataPanel({ section, model, coverage, takeFocus, reduced, onBack, onOpenDetail }: StrataPanelProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (takeFocus) backRef.current?.focus({ preventScroll: true });
  }, [takeFocus, section]);

  const open = (itemKey?: string) => onOpenDetail(section, itemKey);

  return (
    <motion.section
      key={section}
      className="strata-panel"
      data-testid="strata-panel"
      data-section={section}
      aria-label={tb.sections[section]}
      aria-description={tb.sectionHints[section]}
      initial={{ opacity: 0, y: reduced ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: reduced ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="strata-panel-head">
        <Button ref={backRef} variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
          {tb.nav.back}
        </Button>
        <div className="min-w-0 flex-1 flex items-baseline gap-3">
          <h3 className="typo-heading-lg text-foreground truncate">{tb.sections[section]}</h3>
          <StrataFigure value={coverage} unit="ratio" className="typo-data-lg text-primary" />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<PanelRightOpen className="w-4 h-4" />}
          onClick={() => open()}
          data-testid="strata-open-detail"
        >
          {tb.nav.openDetail}
        </Button>
      </header>
      <div className="strata-panel-body">
        {section === 'identity' && <IdentityDetail model={model} onOpen={open} />}
        {section === 'voice' && <VoiceDetail model={model} onOpen={open} />}
        {section === 'knowledge' && <KnowledgeDetail model={model} onOpen={open} />}
        {section === 'training' && <TrainingDetail model={model} onOpen={open} />}
      </div>
    </motion.section>
  );
}

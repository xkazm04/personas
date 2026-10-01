/**
 * L2: the segment the ring zoomed into, unfolded into its own detailed
 * sub-ring with a legend. The header carries Back (focus lands on it when the
 * user opened L2 from the ring), the section's name and headline coverage, and
 * "Full detail", which opens L3 through the page shell. Items in the panel
 * open L3 for one channel, topic or goal.
 */
import { useEffect, useRef } from 'react';
import { ArrowLeft, PanelRightOpen } from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

import type { SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { IdentityFocus } from './focus/IdentityFocus';
import { KnowledgeFocus } from './focus/KnowledgeFocus';
import { TrainingFocus } from './focus/TrainingFocus';
import { VoiceFocus } from './focus/VoiceFocus';
import type { RadialIds } from './glyphs/primitives';
import { RadialFigure } from './RadialFigure';
import { focusPanelWidth } from './radialLayout';

interface RadialFocusProps {
  section: SectionId;
  model: TwinBlueprintModel;
  coverage: number | null;
  ids: RadialIds;
  /** Canvas width (sizes the panel). */
  w: number;
  /** Move keyboard focus to Back once mounted (the user opened L2 from the ring). */
  takeFocus: boolean;
  reduced: boolean;
  onBack: () => void;
  onOpenDetail: (section: SectionId, itemKey?: string) => void;
}

export function RadialFocus({ section, model, coverage, ids, w, takeFocus, reduced, onBack, onOpenDetail }: RadialFocusProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (takeFocus) backRef.current?.focus({ preventScroll: true });
  }, [takeFocus, section]);

  const open = (itemKey?: string) => onOpenDetail(section, itemKey);
  const body = { model, ids, panelW: focusPanelWidth(w), reduced, onOpen: open };

  return (
    <section className="rd-focus" data-testid="radial-focus" data-section={section} aria-label={tb.sections[section]}>
      <motion.header
        className="rd-focus-head"
        initial={{ opacity: 0, y: reduced ? 0 : -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: reduced ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        <Button ref={backRef} variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
          {tb.nav.back}
        </Button>
        <div className="rd-focus-title">
          <h3 className="typo-heading-lg text-foreground">{tb.sections[section]}</h3>
          <RadialFigure value={coverage} unit="ratio" className="typo-data-lg text-primary" />
          <span className="typo-caption">{tb.sectionHints[section]}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<PanelRightOpen className="w-4 h-4" />}
          onClick={() => open()}
          data-testid="radial-open-detail"
        >
          {tb.nav.openDetail}
        </Button>
      </motion.header>
      {section === 'voice' && <VoiceFocus {...body} />}
      {section === 'training' && <TrainingFocus {...body} />}
      {section === 'knowledge' && <KnowledgeFocus {...body} />}
      {section === 'identity' && <IdentityFocus {...body} />}
    </section>
  );
}

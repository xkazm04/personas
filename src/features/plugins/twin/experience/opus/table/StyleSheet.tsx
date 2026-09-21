/**
 * The style deck, drawn over the right side of the table: the preset gallery,
 * three rolled candidates, or the per-channel drafts to keep. The studio's own
 * pieces (gallery, candidates, preview, pins, notice) are reused as they are;
 * this is only where they are laid out. Accepting writes only the channels
 * left ticked — the studio's rule, unchanged.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Palette } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { PresetGallery } from '../../../setup/style/PresetGallery';
import { RollCandidates } from '../../../setup/style/RollCandidates';
import { StyleDraftPreview } from '../../../setup/style/StyleDraftPreview';
import { StyleNotice } from '../../../setup/style/StyleNotice';
import { PinsBar } from '../../../setup/style/PinsBar';
import type { StyleDock } from './useStyleDock';

interface StyleSheetProps {
  open: boolean;
  dock: StyleDock;
  onClose: () => void;
}

export function StyleSheet({ open, dock, onClose }: StyleSheetProps) {
  const { t } = useTranslation();
  const xo = t.twin.experience_opus.style;
  const reduced = useReducedMotion();
  const { studio, currentTones } = dock;
  const inPreview = studio.phase === 'materializing' || studio.phase === 'preview' || studio.phase === 'applying';
  const inRoll = studio.phase === 'rolling' || studio.phase === 'candidates';

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="style-sheet"
          aria-labelledby="xo-style-sheet-title"
          data-testid="xo-style-sheet"
          initial={reduced ? { opacity: 0 } : { x: '100%', opacity: 0.6 }}
          animate={{ x: 0, opacity: 1, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
          exit={reduced ? { opacity: 0 } : { x: '100%', opacity: 0.6, transition: { duration: 0.22 } }}
          className="absolute inset-y-0 right-0 z-10 w-[min(52rem,94%)] flex flex-col bg-background border-l border-primary/15 shadow-elevation-4"
        >
          <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-primary/10">
            <Palette className="w-4 h-4 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 id="xo-style-sheet-title" className="typo-section-title">
                {xo.title}
              </h3>
              <p className="typo-caption">{xo.hint}</p>
            </div>
            {!inPreview && <PinsBar pins={studio.pins} onClear={studio.clearPins} />}
            <Button variant="ghost" size="sm" onClick={onClose} data-testid="xo-style-sheet-close">
              {xo.backToTable}
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
            {studio.error && <StyleNotice error={studio.error} onDismiss={studio.dismissError} />}
            {inPreview ? (
              <StyleDraftPreview studio={studio} currentTones={currentTones} />
            ) : inRoll ? (
              <RollCandidates studio={studio} />
            ) : (
              <PresetGallery studio={studio} />
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

export default StyleSheet;

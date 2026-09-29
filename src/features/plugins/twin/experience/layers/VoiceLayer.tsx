/**
 * The voice studio, one layer down: the preset gallery, three rolled
 * candidates, or the per-channel drafts to keep.
 *
 * The studio's own pieces (gallery, candidates, preview, pins, notice) are
 * reused exactly as they are; this is only where they are laid out and what
 * says, in one line, where the drafting has got to. Accepting writes only the
 * channels left ticked — the studio's rule, unchanged.
 */

import { Palette } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PresetGallery } from '../../setup/style/PresetGallery';
import { RollCandidates } from '../../setup/style/RollCandidates';
import { StyleDraftPreview } from '../../setup/style/StyleDraftPreview';
import { StyleNotice } from '../../setup/style/StyleNotice';
import { PinsBar } from '../../setup/style/PinsBar';
import { LayerFrame } from './LayerFrame';
import type { VoiceDock } from './useVoiceDock';

interface VoiceLayerProps {
  open: boolean;
  onClose: () => void;
  dock: VoiceDock;
}

export function VoiceLayer({ open, onClose, dock }: VoiceLayerProps) {
  const { t, tx: fmt } = useTranslation();
  const tx = t.twin.experience.studio;
  const { studio, currentTones } = dock;
  const name = studio.chosen?.name ?? '';
  const inPreview = studio.phase === 'materializing' || studio.phase === 'preview' || studio.phase === 'applying';
  const inRoll = studio.phase === 'rolling' || studio.phase === 'candidates';

  const status =
    studio.phase === 'materializing'
      ? fmt(tx.drafting, { name })
      : studio.phase === 'rolling'
        ? tx.rolling
        : studio.phase === 'candidates'
          ? tx.candidates
          : studio.phase === 'preview'
            ? fmt(tx.ready, { name })
            : studio.phase === 'applying'
              ? tx.saving
              : tx.idle;

  return (
    <LayerFrame
      open={open}
      onClose={onClose}
      icon={<Palette className="w-4 h-4" />}
      title={tx.title}
      hint={status}
      aside={!inPreview ? <PinsBar pins={studio.pins} onClear={studio.clearPins} /> : undefined}
      width="wide"
      testId="mr-voice"
    >
      <div className="px-5 py-4 space-y-3">
        {studio.error && <StyleNotice error={studio.error} onDismiss={studio.dismissError} />}
        {inPreview ? (
          <StyleDraftPreview studio={studio} currentTones={currentTones} />
        ) : inRoll ? (
          <RollCandidates studio={studio} />
        ) : (
          <PresetGallery studio={studio} />
        )}
      </div>
    </LayerFrame>
  );
}

export default VoiceLayer;

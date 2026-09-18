/**
 * The Style studio, at the top of the Fields page's Tone section.
 *
 * Permanent chrome (title, hint, pins bar, notice) renders on the first frame
 * and never leaves; the body swaps by phase: the gallery, the rolled
 * candidates, or the per-channel preview. A starting style chosen in the
 * create dialog arrives through `takePendingStyleStart` and runs once here.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Palette } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { useStyleStudio } from './useStyleStudio';
import { takePendingStyleStart } from './pendingStyleStart';
import { PresetGallery } from './PresetGallery';
import { RollCandidates } from './RollCandidates';
import { StyleDraftPreview } from './StyleDraftPreview';
import { StyleNotice } from './StyleNotice';
import { PinsBar } from './PinsBar';

interface StylePanelProps {
  /** 'generic' + every bound channel type: the session's `toneChannels`. */
  channels: string[];
}

export function StylePanel({ channels }: StylePanelProps) {
  const { t } = useTranslation();
  const ts = t.twin.style.panel;
  const twinId = useSystemStore((s) => s.activeTwinId);
  const twinTones = useSystemStore((s) => s.twinTones);
  const studio = useStyleStudio(twinId, channels);
  const rootRef = useRef<HTMLElement>(null);

  // Same rows the Setup session reads, scoped to this twin.
  const currentTones = useMemo(
    () => (twinId ? twinTones.filter((tone) => tone.twin_id === twinId) : []),
    [twinId, twinTones],
  );

  // The create dialog's one-shot handoff. `take` deletes, so a remount (or
  // StrictMode's double effect) cannot replay the roll.
  const { pickPreset, roll } = studio;
  useEffect(() => {
    if (!twinId) return;
    const start = takePendingStyleStart(twinId);
    if (!start) return;
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const run = start.kind === 'preset' ? pickPreset(start.presetId) : roll();
    run.catch(silentCatch('features/plugins/twin/setup/style/StylePanel:pendingStart'));
  }, [twinId, pickPreset, roll]);

  const inPreview = studio.phase === 'materializing' || studio.phase === 'preview' || studio.phase === 'applying';
  const inRoll = studio.phase === 'rolling' || studio.phase === 'candidates';

  return (
    <section
      ref={rootRef}
      className="rounded-card border border-primary/15 bg-secondary/10 p-4 space-y-3 scroll-mt-4"
      data-testid="style-panel"
      aria-labelledby="style-panel-title"
    >
      <div className="flex flex-wrap items-start gap-3">
        <Palette className="w-4 h-4 mt-1 text-primary flex-shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h3 id="style-panel-title" className="typo-title">{ts.title}</h3>
          <p className="typo-caption">{ts.hint}</p>
        </div>
        {!inPreview && <PinsBar pins={studio.pins} onClear={studio.clearPins} />}
      </div>

      {studio.error && <StyleNotice error={studio.error} onDismiss={studio.dismissError} />}

      {inPreview ? (
        <StyleDraftPreview studio={studio} currentTones={currentTones} />
      ) : inRoll ? (
        <RollCandidates studio={studio} />
      ) : (
        <PresetGallery studio={studio} />
      )}
    </section>
  );
}

export default StylePanel;

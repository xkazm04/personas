/**
 * The preview: every drafted channel, current against proposed, each with a
 * tick box (all ticked by default). Accept writes ONLY the ticked channels.
 * While the drafts are being written the rows are a ghost under this same
 * header, so the chrome never blinks out.
 */

import { ArrowLeft, Check } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import { DraftChannelRow } from './DraftChannelRow';
import { PreviewGhost } from './StyleGhosts';
import type { StyleStudioApi } from './styleContract';

interface StyleDraftPreviewProps {
  studio: StyleStudioApi;
  currentTones: TwinTone[];
}

export function StyleDraftPreview({ studio, currentTones }: StyleDraftPreviewProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.style.preview;
  const materializing = studio.phase === 'materializing';
  const noneTicked = studio.selectedChannels.size === 0;
  const name = studio.chosen?.name ?? '';

  return (
    <div className="space-y-3" data-testid="style-preview">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="typo-title truncate">{tx(ts.title, { name })}</p>
          <p className="typo-caption">{noneTicked && !materializing ? ts.noneSelected : ts.hint}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={studio.back}
          disabled={studio.phase === 'applying'}
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
          data-testid="style-back"
        >
          {ts.back}
        </Button>
        <AsyncButton
          onClick={studio.accept}
          disabled={materializing || noneTicked}
          isLoading={studio.phase === 'applying'}
          loadingText={ts.applying}
          variant="accent"
          accentColor="violet"
          size="sm"
          icon={<Check className="w-3.5 h-3.5" />}
          data-testid="style-accept"
        >
          {ts.accept}
        </AsyncButton>
      </div>

      {materializing ? (
        <PreviewGhost channels={studio.channels} label={t.twin.style.gallery.loading} />
      ) : (
        <div className="space-y-3">
          {studio.drafts.map((draft) => (
            <DraftChannelRow
              key={draft.channel}
              draft={draft}
              current={currentTones.find((tone) => tone.channel === draft.channel) ?? null}
              checked={studio.selectedChannels.has(draft.channel)}
              onToggle={studio.toggleChannel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default StyleDraftPreview;

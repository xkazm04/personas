import { Headphones } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useRadioState } from '../hooks/useRadioState';
import { useStationPreview } from '../hooks/useStationPreview';
import RadioConsoleVariant from './RadioConsoleVariant';
import type { RadioVariantProps } from './radioManageShared';

/**
 * Radio — the Settings → Radio tab. Curate which stations appear in the footer
 * picker, set playback defaults (master enable + auto-resume), and preview any
 * station before keeping it. Extracted from the old Settings → Account card;
 * the "Console" mixing-desk layout won the /prototype A/B.
 */
export default function RadioPage() {
  const { t } = useTranslation();
  const { state, stations, loaded } = useRadioState();
  const { previewingId, bufferingId, preview } = useStationPreview(state);

  const radioEnabled = useSystemStore((s) => s.radioEnabled);
  const setRadioEnabled = useSystemStore((s) => s.setRadioEnabled);
  const radioAutoResume = useSystemStore((s) => s.radioAutoResume);
  const setRadioAutoResume = useSystemStore((s) => s.setRadioAutoResume);
  const disabledStationIds = useSystemStore((s) => s.disabledStationIds);
  const setStationDisabled = useSystemStore((s) => s.setStationDisabled);

  const variantProps: RadioVariantProps = {
    stations,
    state,
    previewingId,
    bufferingId,
    onPreview: preview,
    radioEnabled,
    setRadioEnabled,
    radioAutoResume,
    setRadioAutoResume,
    disabledStationIds,
    setStationDisabled,
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Headphones className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.radio.settings_title}
        subtitle={t.radio.manage_subtitle}
      />
      <ContentBody centered>
        <div className="max-w-5xl mx-auto">
          {loaded ? (
            <RadioConsoleVariant {...variantProps} />
          ) : (
            <div className="flex items-center justify-center py-16">
              <LoadingSpinner />
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}

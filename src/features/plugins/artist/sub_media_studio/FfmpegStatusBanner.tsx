import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { FfmpegStatus } from '@/api/artist/index';

interface FfmpegStatusBannerProps {
  status: FfmpegStatus | null;
  checking: boolean;
  onRecheck: () => void;
}

export default function FfmpegStatusBanner({
  status,
  checking,
  onRecheck,
}: FfmpegStatusBannerProps) {
  const { t } = useTranslation();

  if (checking) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-card border border-primary/10">
        <LoadingSpinner size="sm" />
        <span className="typo-body text-muted-foreground">{t.media_studio.check_again}...</span>
      </div>
    );
  }

  // FFmpeg found — compact success badge
  if (status?.found) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span className="typo-body text-emerald-400">{t.media_studio.ffmpeg_found}</span>
      </div>
    );
  }

  // FFmpeg not found — warning banner with install instructions
  return (
    <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="typo-heading text-amber-300">{t.media_studio.ffmpeg_not_found}</p>
          <p className="typo-body text-foreground/70">{t.media_studio.ffmpeg_not_found_hint}</p>

          <ul className="typo-body text-foreground/60 space-y-1 list-disc list-inside">
            <li>{t.media_studio.ffmpeg_install_windows}</li>
            <li>{t.media_studio.ffmpeg_install_mac}</li>
            <li>{t.media_studio.ffmpeg_install_linux}</li>
          </ul>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={onRecheck}
          disabled={checking}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t.media_studio.check_again}
        </Button>
      </div>
    </div>
  );
}

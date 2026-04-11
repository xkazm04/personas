import { MonitorX, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { SessionState } from '../helpers/autoCredHelpers';
import { STATE_CONFIG } from '../helpers/autoCredHelpers';
import { useTranslation } from '@/i18n/useTranslation';

interface BrowserStatusBannerProps {
  sessionState: SessionState;
  isGuided: boolean;
  elapsed: string | null;
}

export function BrowserStatusBanner({ sessionState, isGuided, elapsed }: BrowserStatusBannerProps) {
  const { t } = useTranslation();
  const config = STATE_CONFIG[sessionState];
  const StateIcon = config.icon;

  return (
    <>
      <div
        key={sessionState}
        className={`animate-fade-slide-in flex items-center gap-3 p-3 rounded-xl border ${config.borderColor} ${config.bgColor}`}
      >
        <div className="relative">
          {sessionState === 'connecting' || sessionState === 'working' ? (
            <StateIcon className={`w-5 h-5 ${config.color} ${sessionState === 'connecting' ? 'animate-spin' : 'animate-[spin_3s_linear_infinite]'}`} />
          ) : (
            <StateIcon className={`w-5 h-5 ${config.color}`} />
          )}
          {config.pulse && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${config.color}`}>{config.label}</p>
          <p className="text-sm text-muted-foreground/50 mt-0.5">
            {isGuided ? config.guidedSublabel : config.sublabel}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {elapsed && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground/60 tabular-nums">
              <Clock className="w-3 h-3" />
              {elapsed}
            </span>
          )}
          {(sessionState === 'connecting' || sessionState === 'working') && (
            <LoadingSpinner className={`${config.color} opacity-60`} />
          )}
        </div>
      </div>

      {/* Browser hands-off warning (playwright mode only) */}
      {!isGuided && (sessionState === 'connecting' || sessionState === 'working') && (
        <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg border border-orange-500/20 bg-orange-500/5">
          <MonitorX className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground/70">
            <span className="font-medium text-orange-400/90">{t.vault.auto_cred_extra.do_not_interact}</span>{' '}
            The automation controls the browser window directly -- clicking, scrolling or typing in it may break the process.
          </p>
        </div>
      )}
    </>
  );
}

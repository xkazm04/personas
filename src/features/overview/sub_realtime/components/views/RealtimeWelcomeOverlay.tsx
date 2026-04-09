import { Play } from 'lucide-react';
import { useOverviewTranslation } from '@/features/overview/i18n/useOverviewTranslation';

/**
 * Inline SVG illustration showing a stylised particle flow —
 * a visual preview of what the visualizer looks like with live data.
 */
function ParticleFlowPreview() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="2" y="2" width="52" height="52" rx="12" fill="url(#pf-bg)" />
      {/* Source nodes (left) */}
      <circle cx="12" cy="18" r="3" fill="#6366f1" opacity="0.3" />
      <circle cx="12" cy="28" r="3" fill="#8b5cf6" opacity="0.3" />
      <circle cx="12" cy="38" r="3" fill="#a78bfa" opacity="0.3" />
      {/* Hub */}
      <circle cx="28" cy="28" r="5" fill="#06b6d4" opacity="0.12" stroke="#06b6d4" strokeWidth="0.6" strokeOpacity="0.3" />
      <circle cx="28" cy="28" r="2" fill="#06b6d4" opacity="0.3" />
      {/* Agent nodes (right) */}
      <circle cx="44" cy="22" r="3" fill="#8b5cf6" opacity="0.35" />
      <circle cx="44" cy="34" r="3" fill="#6366f1" opacity="0.35" />
      {/* Particle trails */}
      <line x1="15" y1="18" x2="23" y2="26" stroke="#818cf8" strokeWidth="0.8" strokeLinecap="round" opacity="0.5" />
      <line x1="15" y1="28" x2="23" y2="28" stroke="#a78bfa" strokeWidth="0.8" strokeLinecap="round" opacity="0.5" />
      <line x1="15" y1="38" x2="23" y2="30" stroke="#c4b5fd" strokeWidth="0.8" strokeLinecap="round" opacity="0.5" />
      <line x1="33" y1="26" x2="41" y2="22" stroke="#818cf8" strokeWidth="0.8" strokeLinecap="round" opacity="0.5" />
      <line x1="33" y1="30" x2="41" y2="34" stroke="#a78bfa" strokeWidth="0.8" strokeLinecap="round" opacity="0.5" />
      {/* Animated particles */}
      <circle cx="19" cy="22" r="1.2" fill="#818cf8" opacity="0.8">
        <animate attributeName="cx" values="15;23" dur="2s" repeatCount="indefinite" />
        <animate attributeName="cy" values="18;26" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="19" cy="28" r="1.2" fill="#a78bfa" opacity="0.8">
        <animate attributeName="cx" values="15;23" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="37" cy="24" r="1.2" fill="#818cf8" opacity="0.8">
        <animate attributeName="cx" values="33;41" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="cy" values="26;22" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <defs>
        <linearGradient id="pf-bg" x1="2" y1="2" x2="54" y2="54">
          <stop stopColor="#6366f1" stopOpacity="0.08" />
          <stop offset="1" stopColor="#06b6d4" stopOpacity="0.05" />
        </linearGradient>
      </defs>
    </svg>
  );
}

interface RealtimeWelcomeOverlayProps {
  onTestFlow?: () => void;
}

export function RealtimeWelcomeOverlay({ onTestFlow }: RealtimeWelcomeOverlayProps) {
  const { t } = useOverviewTranslation();
  const es = t.emptyState;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-10">
      <div className="animate-fade-slide-in flex flex-col items-center gap-3 bg-background/60 backdrop-blur-md border border-primary/12 rounded-card px-8 py-6 max-w-sm text-center shadow-elevation-1">
        <ParticleFlowPreview />
        <h3 className="typo-heading text-primary text-[14px] [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
          {es.realtime_title}
        </h3>
        <p className="typo-body text-foreground max-w-[32ch]">
          {es.realtime_subtitle}
        </p>
        {onTestFlow && (
          <button
            onClick={onTestFlow}
            className="inline-flex items-center gap-1.5 px-4 py-2 mt-1 typo-heading rounded-interactive bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            {es.realtime_action}
          </button>
        )}
      </div>
    </div>
  );
}

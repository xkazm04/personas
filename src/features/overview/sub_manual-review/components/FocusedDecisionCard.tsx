import { CheckCircle2, XCircle, Image as ImageIcon, Video } from 'lucide-react';
import { type DecisionItem, type DecisionVerdict, catBorder, isVideoUrl } from './reviewFocusHelpers';
import { useTranslation } from '@/i18n/useTranslation';

interface FocusedDecisionCardProps {
  decision: DecisionItem;
  verdict: DecisionVerdict;
  onToggle: (v: DecisionVerdict) => void;
  imageUrl: string | null;
}

export function FocusedDecisionCard({ decision, verdict, onToggle, imageUrl }: FocusedDecisionCardProps) {
  const hasImage = !!imageUrl;

  return (
    <div className={`rounded-card border border-primary/10 overflow-hidden border-l-2 ${catBorder(decision.category)}`}>
      {hasImage ? (
        /* ---- Image + Text side-by-side layout ---- */
        <div className="flex flex-col md:flex-row">
          <MediaPanel url={imageUrl!} alt={decision.label} />
          <div className="md:w-1/2 p-4 flex flex-col justify-between">
            <div>
              <DecisionMeta category={decision.category} mediaType={isVideoUrl(imageUrl!) ? 'video' : 'image'} />
              <h3 className="text-base font-semibold text-foreground mb-2">{decision.label}</h3>
              {decision.description && (
                <p className="text-sm text-foreground leading-relaxed">{decision.description}</p>
              )}
            </div>
            <VerdictButtons verdict={verdict} onToggle={onToggle} layout="full" />
          </div>
        </div>
      ) : (
        /* ---- Text-only layout (full width, spacious) ---- */
        <div className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DecisionMeta category={decision.category} />
              <h3 className="text-base font-semibold text-foreground mb-1">{decision.label}</h3>
              {decision.description && (
                <p className="text-sm text-foreground leading-relaxed">{decision.description}</p>
              )}
            </div>
            <VerdictButtons verdict={verdict} onToggle={onToggle} layout="compact" />
          </div>
        </div>
      )}
    </div>
  );
}

// -- Sub-components (file-private) ------------------------------------------

function DecisionMeta({ category, mediaType }: { category?: string; mediaType?: 'image' | 'video' }) {
  if (!category && !mediaType) return null;
  return (
    <div className="flex items-center gap-2 mb-1.5">
      {category && (
        <span className="text-xs font-medium text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">{category}</span>
      )}
      {mediaType === 'video' ? (
        <Video className="w-3 h-3 text-foreground" />
      ) : mediaType === 'image' ? (
        <ImageIcon className="w-3 h-3 text-foreground" />
      ) : null}
    </div>
  );
}

function MediaPanel({ url, alt }: { url: string; alt: string }) {
  const { t } = useTranslation();
  const handleMediaError = (e: React.SyntheticEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    el.style.display = 'none';
    const fallback = `<div class="flex flex-col items-center gap-2 py-12 text-foreground"><span class="text-sm">${t.overview.focused_decision.media_unavailable}</span></div>`;
    if (el.parentElement) el.parentElement.innerHTML = fallback;
  };

  return (
    <div className="md:w-1/2 bg-black/20 flex items-center justify-center min-h-[200px] max-h-[400px] overflow-hidden">
      {isVideoUrl(url) ? (
        <video src={url} controls className="w-full h-full object-contain" onError={handleMediaError}>
          Your browser does not support video playback.
        </video>
      ) : (
        <img src={url} alt={alt} className="w-full h-full object-contain" loading="lazy" onError={handleMediaError} />
      )}
    </div>
  );
}

function VerdictButtons({ verdict, onToggle, layout }: { verdict: DecisionVerdict; onToggle: (v: DecisionVerdict) => void; layout: 'full' | 'compact' }) {
  const { t } = useTranslation();
  const wrapperClass = layout === 'full'
    ? 'flex items-center gap-2 mt-4 pt-3 border-t border-primary/10'
    : 'flex items-center gap-1.5 flex-shrink-0 pt-1';

  const btnBase = layout === 'full'
    ? 'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-card text-sm font-medium transition-all'
    : 'flex items-center gap-1.5 px-3 py-2 rounded-card text-sm font-medium transition-all';

  return (
    <div className={wrapperClass}>
      <button
        onClick={() => onToggle('accept')}
        className={`${btnBase} ${verdict === 'accept'
          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
          : `bg-secondary/30 ${layout === 'full' ? 'text-foreground' : 'text-foreground'} hover:bg-emerald-500/10 hover:text-emerald-400`
        }`}
      >
        <CheckCircle2 className="w-4 h-4" />
        {t.overview.focused_decision.accept}
      </button>
      <button
        onClick={() => onToggle('reject')}
        className={`${btnBase} ${verdict === 'reject'
          ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
          : `bg-secondary/30 ${layout === 'full' ? 'text-foreground' : 'text-foreground'} hover:bg-red-500/10 hover:text-red-400`
        }`}
      >
        <XCircle className="w-4 h-4" />
        {t.overview.focused_decision.reject}
      </button>
    </div>
  );
}

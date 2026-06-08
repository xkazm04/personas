import { CheckCircle2, XCircle, Image as ImageIcon, Video } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { type DecisionItem, type DecisionVerdict, catBorder, isVideoUrl } from './reviewFocusHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';


interface FocusedDecisionCardProps {
  decision: DecisionItem;
  verdict: DecisionVerdict;
  onDecide: (v: 'accept' | 'reject') => void;
  imageUrl: string | null;
}

export function FocusedDecisionCard({ decision, verdict, onDecide, imageUrl }: FocusedDecisionCardProps) {
  const hasImage = !!imageUrl;

  return (
    <div className={`relative rounded-card border border-primary/10 overflow-hidden border-l-2 ${catBorder(decision.category)}`}>
      {/* Absolute-positioned verdict buttons — overlay so they don't eat content width. */}
      <VerdictButtons verdict={verdict} onDecide={onDecide} />

      {hasImage ? (
        /* ---- Image + Text side-by-side layout (full content width) ---- */
        <div className="flex flex-col md:flex-row">
          <MediaPanel url={imageUrl!} alt={decision.label} />
          <div className="md:flex-1 p-4 pr-32">
            <DecisionMeta category={decision.category} mediaType={isVideoUrl(imageUrl!) ? 'video' : 'image'} />
            <h3 className="typo-body-lg font-semibold text-foreground mb-2">{decision.label}</h3>
            {decision.description && (
              <MarkdownRenderer content={decision.description} className="typo-body text-foreground leading-relaxed" />
            )}
          </div>
        </div>
      ) : (
        /* ---- Text-only layout (full width) ---- */
        <div className="p-4 pr-32">
          <DecisionMeta category={decision.category} />
          <h3 className="typo-body-lg font-semibold text-foreground mb-1">{decision.label}</h3>
          {decision.description && (
            <MarkdownRenderer content={decision.description} className="typo-body text-foreground leading-relaxed" />
          )}
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
        <span className="typo-caption font-medium text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">{category}</span>
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
          <DebtText k="auto_your_browser_does_not_support_video_playba_8f8c2d0d" />
        </video>
      ) : (
        <img src={url} alt={alt} className="w-full h-full object-contain" loading="lazy" onError={handleMediaError} />
      )}
    </div>
  );
}

function VerdictButtons({ verdict, onDecide }: { verdict: DecisionVerdict; onDecide: (v: 'accept' | 'reject') => void }) {
  const { t } = useTranslation();

  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
      <button
        onClick={() => onDecide('reject')}
        title={t.overview.focused_decision.reject}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-card typo-caption font-medium transition-all shadow-elevation-1 backdrop-blur-sm ${
          verdict === 'reject'
            ? 'bg-red-500/30 text-red-400 ring-1 ring-red-500/40'
            : 'bg-background/80 text-foreground hover:bg-red-500/15 hover:text-red-400 ring-1 ring-primary/15'
        }`}
      >
        <XCircle className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t.overview.focused_decision.reject}</span>
      </button>
      <button
        onClick={() => onDecide('accept')}
        title={t.overview.focused_decision.accept}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-card typo-caption font-medium transition-all shadow-elevation-1 backdrop-blur-sm ${
          verdict === 'accept'
            ? 'bg-emerald-500/30 text-emerald-400 ring-1 ring-emerald-500/40'
            : 'bg-background/80 text-foreground hover:bg-emerald-500/15 hover:text-emerald-400 ring-1 ring-primary/15'
        }`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t.overview.focused_decision.accept}</span>
      </button>
    </div>
  );
}

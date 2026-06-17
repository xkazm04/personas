import { X, Play, RotateCcw, Check, Compass } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import type { TourDef } from '@/stores/slices/system/tourSlice';
import { TOUR_ICONS, getColors } from './data';
import { getTourIllustration } from './illustrations';

interface TourDetailModalProps {
  tour: TourDef;
  isCompleted: boolean;
  onStart: () => void;
  onClose: () => void;
}

export function TourDetailModal({ tour, isCompleted, onStart, onClose }: TourDetailModalProps) {
  const { t, tx } = useTranslation();
  const ht = t.home.learning;
  const Icon = TOUR_ICONS[tour.icon] ?? Compass;
  const colors = getColors(tour.color);
  const illustration = getTourIllustration(tour.id);

  return (
    <BaseModal isOpen onClose={onClose} titleId={`tour-modal-${tour.id}`} maxWidthClass="max-w-2xl" portal>
      <div
        data-testid={`tour-modal-${tour.id}`}
        className="relative isolate bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Tour-specific decorative background illustration (Leonardo). A faint
            themed wash behind the content — mix-blend-screen drops the
            near-black source background out on any theme, and the mask fades it
            before it reaches the step list so dense text stays legible. */}
        {illustration && (
          <img
            src={illustration}
            alt=""
            aria-hidden
            draggable={false}
            className="pointer-events-none select-none absolute inset-0 z-0 h-full w-full object-cover opacity-[0.32] mix-blend-screen"
            style={{
              maskImage: 'linear-gradient(to bottom, #000 0%, #000 26%, rgba(0,0,0,0.3) 62%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 26%, rgba(0,0,0,0.3) 62%, transparent 100%)',
            }}
          />
        )}

        {/* Header */}
        <div className="relative z-10 flex items-start justify-between px-6 py-5 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-modal ${colors.bg} border ${colors.border} flex items-center justify-center shadow-elevation-1`}>
              <Icon className={`w-5 h-5 ${colors.text}`} />
            </div>
            <div className="space-y-0.5">
              <h3 className="typo-heading text-foreground">{tour.title}</h3>
              <span className={`text-[11px] font-medium ${colors.text}`}>{tx(ht.steps_count, { count: tour.steps.length })}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isCompleted && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium px-2 py-0.5 rounded-input bg-emerald-500/10 border border-emerald-500/20">
                <Check className="w-2.5 h-2.5" />
                {ht.done}
              </span>
            )}
            <button
              onClick={onClose}
              aria-label={t.common.close}
              className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-foreground hover:text-foreground/80"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="relative z-10 flex-1 overflow-y-auto p-6 space-y-5">
          <p className="typo-body text-foreground leading-relaxed">{tour.description}</p>

          <div className="space-y-3">
            <span className={`typo-label ${colors.text}`}>{ht.tour_steps_label}</span>
            <ol className="space-y-1">
              {tour.steps.map((step, i) => (
                <li
                  key={step.id}
                  className="flex items-start gap-3 rounded-card px-2.5 py-2 -mx-2.5 transition-colors hover:bg-secondary/40"
                >
                  <span className={`flex-shrink-0 w-6 h-6 rounded-full ${colors.bg} border ${colors.border} ${colors.text} flex items-center justify-center text-[11px] font-mono font-semibold mt-0.5`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className={`typo-body font-semibold ${colors.text}`}>{step.title}</p>
                    <p className="text-[13px] text-foreground leading-relaxed">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center justify-end px-6 py-4 border-t border-primary/10 flex-shrink-0">
          <button
            onClick={onStart}
            data-testid={`tour-modal-start-${tour.id}`}
            className={`flex items-center gap-2 px-5 py-2 typo-heading rounded-modal ${colors.btnBg} ${colors.btnText} border ${colors.btnBorder} hover:brightness-125 transition-all`}
          >
            {isCompleted ? <><RotateCcw className="w-3.5 h-3.5" /> {ht.restart}</> : <><Play className="w-3.5 h-3.5" /> {ht.start_tour}</>}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

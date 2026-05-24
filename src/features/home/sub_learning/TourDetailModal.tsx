import { X, Play, RotateCcw, Check, Compass } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import type { TourDef } from '@/stores/slices/system/tourSlice';
import { TOUR_ICONS, getColors } from './data';

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

  return (
    <BaseModal isOpen onClose={onClose} titleId={`tour-modal-${tour.id}`} maxWidthClass="max-w-2xl" portal>
      <div
        data-testid={`tour-modal-${tour.id}`}
        className="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-modal ${colors.bg} border ${colors.border} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${colors.text}`} />
            </div>
            <div>
              <h3 className="typo-heading text-foreground">{tour.title}</h3>
              <span className="text-[11px] text-foreground">{tx(ht.steps_count, { count: tour.steps.length })}</span>
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
              className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-foreground hover:text-foreground/80"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <p className="typo-body text-foreground leading-relaxed">{tour.description}</p>

          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">{ht.tour_steps_label}</span>
            <div className="space-y-2.5 pl-0.5">
              {tour.steps.map((step, i) => (
                <div key={step.id} className="flex items-start gap-3">
                  <span className={`flex-shrink-0 w-5 h-5 rounded-full ${colors.bg} border ${colors.border} ${colors.text} flex items-center justify-center text-[10px] font-mono font-semibold mt-0.5`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="typo-body font-medium text-foreground">{step.title}</p>
                    <p className="text-[11px] text-foreground leading-relaxed">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-primary/10 flex-shrink-0">
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

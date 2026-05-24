import { X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import type { Trick } from './data';

export function TrickModal({ trick, onClose }: { trick: Trick; onClose: () => void }) {
  const { t } = useTranslation();
  const ht = t.home.learning;
  return (
    <BaseModal isOpen onClose={onClose} titleId={`trick-modal-${trick.id}`} maxWidthClass="max-w-3xl" portal>
      <div className="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-modal bg-secondary/30 border border-primary/10 flex items-center justify-center">
              <trick.icon className={`w-4.5 h-4.5 ${trick.color}`} />
            </div>
            <div>
              <h3 className="typo-heading text-foreground/90">{trick.title}</h3>
              <p className="text-[11px] text-foreground">{trick.tagline}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-foreground hover:text-foreground/80"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Screenshot */}
          <div className="rounded-modal overflow-hidden border border-primary/10 bg-black/20">
            <img
              src={trick.screenshot}
              alt={trick.title}
              className="w-full h-auto"
              data-testid={`trick-img-${trick.id}`}
            />
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">{ht.how_to_use}</span>
            <div className="space-y-2 pl-0.5">
              {trick.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-[11px] font-mono text-foreground mt-0.5 w-5 flex-shrink-0 text-right">{i + 1}.</span>
                  <p className="typo-body text-foreground leading-relaxed">
                    {step.bold ? (
                      <>{step.text} <span className="font-semibold text-foreground">{step.bold}</span></>
                    ) : step.text}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Pro tip */}
          {trick.proTip && (
            <div className="rounded-modal bg-amber-500/5 border border-amber-500/15 px-4 py-3">
              <p className="typo-body text-amber-300/70 leading-relaxed">
                <span className="font-semibold text-amber-400">{ht.pro_tip}</span>{trick.proTip}
              </p>
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  );
}

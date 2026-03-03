import { Cpu, Bell } from 'lucide-react';
import type { UseCaseItem } from '@/features/shared/components/UseCasesList';

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  notification:   { bg: 'bg-rose-500/10 border-rose-500/15',   text: 'text-rose-400/70' },
  'data-sync':    { bg: 'bg-cyan-500/10 border-cyan-500/15',   text: 'text-cyan-400/70' },
  monitoring:     { bg: 'bg-amber-500/10 border-amber-500/15', text: 'text-amber-400/70' },
  automation:     { bg: 'bg-violet-500/10 border-violet-500/15', text: 'text-violet-400/70' },
  communication:  { bg: 'bg-blue-500/10 border-blue-500/15',   text: 'text-blue-400/70' },
  reporting:      { bg: 'bg-emerald-500/10 border-emerald-500/15', text: 'text-emerald-400/70' },
};

interface UseCaseListPanelProps {
  useCases: UseCaseItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function UseCaseListPanel({ useCases, selectedId, onSelect }: UseCaseListPanelProps) {
  if (useCases.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground/60">
        No use cases defined yet.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {useCases.map((uc, i) => {
        const isSelected = uc.id === selectedId;
        const catStyle = uc.category ? CATEGORY_STYLES[uc.category] : null;
        const hasModelOverride = !!uc.model_override;
        const hasNotifications = (uc.notification_channels?.length ?? 0) > 0;

        return (
          <button
            key={uc.id || i}
            onClick={() => onSelect(uc.id)}
            className={`w-full text-left p-2.5 rounded-xl border transition-all ${
              isSelected
                ? 'border-primary/30 bg-primary/8 ring-1 ring-primary/20'
                : 'border-primary/10 bg-secondary/20 hover:border-primary/20 hover:bg-secondary/30'
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="text-sm font-semibold text-muted-foreground/50 mt-0.5 w-4 text-right flex-shrink-0">
                {i + 1}.
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-foreground/90 truncate">{uc.title}</p>
                  {uc.category && catStyle && (
                    <span className={`px-1 py-0.5 text-[9px] font-medium rounded border ${catStyle.bg} ${catStyle.text} uppercase tracking-wider flex-shrink-0`}>
                      {uc.category.replace('-', ' ')}
                    </span>
                  )}
                </div>
                {/* Override indicators */}
                {(hasModelOverride || hasNotifications) && (
                  <div className="flex items-center gap-2 mt-1">
                    {hasModelOverride && (
                      <span className="flex items-center gap-0.5 text-[10px] text-primary/60" title="Custom model">
                        <Cpu className="w-2.5 h-2.5" />
                      </span>
                    )}
                    {hasNotifications && (
                      <span className="flex items-center gap-0.5 text-[10px] text-amber-400/60" title="Notifications configured">
                        <Bell className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

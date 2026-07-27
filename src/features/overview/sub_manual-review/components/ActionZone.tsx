import { useTranslation } from '@/i18n/useTranslation';
import { Collapse } from '@/features/shared/components/display/Collapse';

interface ActionZoneProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  colorClasses: string;
  activeClasses: string;
  notes: string;
  onNotesChange: (v: string) => void;
  onConfirm: () => void;
  isProcessing: boolean;
  confirmColor: string;
}

export function ActionZone({ active, onClick, icon, label, colorClasses, activeClasses, notes, onNotesChange, onConfirm, isProcessing, confirmColor }: ActionZoneProps) {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-col transition-colors ${active ? activeClasses : ''}`}>
      <button
        onClick={onClick}
        disabled={isProcessing}
        className={`flex items-center justify-center gap-2 py-4 typo-body font-medium transition-colors disabled:opacity-50 ${colorClasses}`}
      >
        {icon}
        <span>{label}</span>
      </button>
      <Collapse open={active} unmountWhenClosed duration={200}>
        <div className="px-3 pb-3 space-y-2">
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder={t.overview.review_extra.add_note}
            rows={2}
            className="w-full rounded-input border border-primary/10 bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
            autoFocus
          />
          <button
            onClick={onConfirm}
            disabled={isProcessing}
            className={`w-full py-1.5 rounded-input typo-caption font-medium transition-colors disabled:opacity-50 ${confirmColor}`}
          >
            {isProcessing ? t.overview.review_extra.processing : t.overview.review_extra.confirm}
          </button>
        </div>
      </Collapse>
    </div>
  );
}

import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
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
  confirmTone: 'error' | 'warning' | 'success';
}

export function ActionZone({ active, onClick, icon, label, colorClasses, activeClasses, notes, onNotesChange, onConfirm, isProcessing, confirmTone }: ActionZoneProps) {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-col transition-colors ${active ? activeClasses : ''}`}>
      <PressSurface
        onPress={onClick}
        disabled={isProcessing}
        className={`flex items-center justify-center gap-2 py-4 typo-body ${colorClasses}`}
      >
        {icon}
        <span>{label}</span>
      </PressSurface>
      <Collapse open={active} unmountWhenClosed duration={200}>
        <div className="px-3 pb-3 space-y-2">
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder={t.overview.review_extra.add_note}
            rows={2}
            className="w-full rounded-input border border-hair bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
            autoFocus
          />
          <Button variant="accent" tone={confirmTone} size="sm" onClick={onConfirm} disabled={isProcessing} className="w-full">
            {isProcessing ? t.overview.review_extra.processing : t.overview.review_extra.confirm}
          </Button>
        </div>
      </Collapse>
    </div>
  );
}

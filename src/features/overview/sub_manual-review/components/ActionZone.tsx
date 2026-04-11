import { useTranslation } from '@/i18n/useTranslation';
import { AnimatePresence, motion } from 'framer-motion';

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
        className={`flex items-center justify-center gap-2 py-4 text-sm font-medium transition-colors disabled:opacity-50 ${colorClasses}`}
      >
        {icon}
        <span>{label}</span>
      </button>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              <textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder={t.overview.review_extra.add_note}
                rows={2}
                className="w-full rounded-md border border-primary/10 bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                autoFocus
              />
              <button
                onClick={onConfirm}
                disabled={isProcessing}
                className={`w-full py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${confirmColor}`}
              >
                {isProcessing ? t.overview.review_extra.processing : t.overview.review_extra.confirm}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

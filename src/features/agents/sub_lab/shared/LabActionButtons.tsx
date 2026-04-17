import { type ReactNode } from 'react';
import { Play, Square } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { DisabledGuide, type GuideItem } from './DisabledGuide';
import { LIST_ITEM_GAP } from '@/lib/utils/designTokens';

interface LabActionButtonsProps {
  isRunning: boolean;
  onStart: () => void;
  onCancel: () => void;
  disabled: boolean;
  disabledReason?: string;
  guideItems?: GuideItem[];
  runLabel: ReactNode;
  cancelLabel?: string;
  runIcon?: ReactNode;
  runClassName?: string;
  cancelTestId?: string;
  runTestId?: string;
}

export function LabActionButtons({
  isRunning, onStart, onCancel, disabled, disabledReason = '',
  guideItems, runLabel, cancelLabel, runIcon, runClassName, cancelTestId, runTestId,
}: LabActionButtonsProps) {
  const { t } = useTranslation();
  const resolvedCancelLabel = cancelLabel ?? t.agents.lab.cancel_default;

  if (isRunning) {
    return (
      <button data-testid={cancelTestId} onClick={onCancel}
        className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-modal font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-elevation-3 shadow-red-500/20">
        <Square className="w-4 h-4" />{resolvedCancelLabel}
      </button>
    );
  }

  const activeGuide = disabled && guideItems && guideItems.length > 0 ? guideItems : null;

  return (
    <div className={`flex flex-col ${LIST_ITEM_GAP.cards}`}>
      <Tooltip content={activeGuide ? '' : disabledReason} placement="top" delay={200}>
        <button data-testid={runTestId} onClick={onStart} disabled={disabled}
          className={runClassName ?? "w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-modal font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-elevation-3 shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"}>
          {runIcon ?? <Play className="w-4 h-4" />}{runLabel}
        </button>
      </Tooltip>
      {activeGuide && <DisabledGuide items={activeGuide} />}
    </div>
  );
}

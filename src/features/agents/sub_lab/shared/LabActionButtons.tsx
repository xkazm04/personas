import { type ReactNode } from 'react';
import { Play, Square } from 'lucide-react';
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
  guideItems, runLabel, cancelLabel = 'Cancel', runIcon, runClassName, cancelTestId, runTestId,
}: LabActionButtonsProps) {
  if (isRunning) {
    return (
      <button data-testid={cancelTestId} onClick={onCancel}
        className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-elevation-3 shadow-red-500/20">
        <Square className="w-4 h-4" />{cancelLabel}
      </button>
    );
  }

  const activeGuide = disabled && guideItems && guideItems.length > 0 ? guideItems : null;

  return (
    <div className={`flex flex-col ${LIST_ITEM_GAP.cards}`}>
      <button data-testid={runTestId} onClick={onStart} disabled={disabled}
        aria-describedby={activeGuide ? undefined : disabledReason ? 'lab-disabled-hint' : undefined}
        className={runClassName ?? "w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-elevation-3 shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"}>
        {runIcon ?? <Play className="w-4 h-4" />}{runLabel}
      </button>
      {activeGuide && <DisabledGuide items={activeGuide} />}
    </div>
  );
}

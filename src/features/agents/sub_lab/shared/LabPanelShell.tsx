import type { ReactNode } from 'react';
import { LabProgress } from '../components/shared/LabProgress';
import { LabActionButtons } from './LabActionButtons';
import type { GuideItem } from './DisabledGuide';

interface LabPanelShellProps {
  children: ReactNode;
  /** Props forwarded to LabActionButtons */
  isRunning: boolean;
  onStart: () => void;
  onCancel: () => void;
  disabled: boolean;
  disabledReason: string;
  guideItems?: GuideItem[];
  runLabel: ReactNode;
  cancelLabel: string;
  cancelTestId: string;
  runTestId: string;
  runIcon?: ReactNode;
  runClassName?: string;
  /** Optional data-testid on the outer container */
  'data-testid'?: string;
}

export function LabPanelShell({
  children,
  isRunning,
  onStart,
  onCancel,
  disabled,
  disabledReason,
  guideItems,
  runLabel,
  cancelLabel,
  cancelTestId,
  runTestId,
  runIcon,
  runClassName,
  'data-testid': testId,
}: LabPanelShellProps) {
  return (
    <div
      className="border border-primary/20 rounded-modal overflow-hidden backdrop-blur-sm bg-secondary/40"
      data-testid={testId}
    >
      <div className="p-4 space-y-3">
        {children}

        <LabActionButtons
          isRunning={isRunning}
          onStart={onStart}
          onCancel={onCancel}
          disabled={disabled}
          disabledReason={disabledReason}
          guideItems={guideItems}
          runLabel={runLabel}
          cancelLabel={cancelLabel}
          cancelTestId={cancelTestId}
          runTestId={runTestId}
          runIcon={runIcon}
          runClassName={runClassName}
        />

        <LabProgress />
      </div>
    </div>
  );
}

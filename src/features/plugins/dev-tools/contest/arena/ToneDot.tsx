// A state as a dot + a word in caption size — the Arena's replacement for the
// 10px status pill. The dot carries the tone; the word carries the meaning, so
// colour is never the only signal.
import type { ReactNode } from 'react';

import type { StatusVariant } from '@/features/shared/components/display/StatusBadge';

const DOT: Record<StatusVariant, string> = {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  info: 'bg-status-info',
  neutral: 'bg-status-neutral',
  processing: 'bg-status-processing',
};

export interface ToneDotProps {
  tone: StatusVariant;
  children: ReactNode;
  className?: string;
  testId?: string;
}

export function ToneDot({ tone, children, className = '', testId }: ToneDotProps) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 typo-caption ${className}`} data-testid={testId}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-pill ${DOT[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

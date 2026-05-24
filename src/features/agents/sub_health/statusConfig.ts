import { CheckCircle2, AlertTriangle, XCircle, type LucideIcon } from 'lucide-react';
import type { DryRunResult } from './types';

export type StatusLabelKey = 'status_ready' | 'status_partial' | 'status_blocked';

interface StatusConfigEntry {
  icon: LucideIcon;
  labelKey: StatusLabelKey;
  rowBorderClass: string;
  dotClass: string;
}

export const STATUS_CONFIG: Record<DryRunResult['status'], StatusConfigEntry> = {
  ready: {
    icon: CheckCircle2,
    labelKey: 'status_ready',
    rowBorderClass: 'border-l-2 border-l-transparent',
    dotClass: 'bg-emerald-400',
  },
  partial: {
    icon: AlertTriangle,
    labelKey: 'status_partial',
    rowBorderClass: 'border-l-2 border-l-amber-500',
    dotClass: 'bg-amber-400',
  },
  blocked: {
    icon: XCircle,
    labelKey: 'status_blocked',
    rowBorderClass: 'border-l-[3px] border-l-red-500 shadow-elevation-1 bg-red-500/[0.03]',
    dotClass: 'bg-red-400',
  },
};

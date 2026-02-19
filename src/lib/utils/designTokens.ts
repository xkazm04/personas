export interface StatusColorToken {
  color: string;
  bgColor: string;
  borderColor: string;
}

/** Severity-level colors: info, warning, critical */
export const SEVERITY_COLORS: Record<string, StatusColorToken> = {
  info: { color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30' },
  warning: { color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
  critical: { color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
};

/** Review status colors: pending, approved, rejected */
export const STATUS_COLORS: Record<string, StatusColorToken> = {
  pending: { color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
  approved: { color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' },
  rejected: { color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
};

/** Feasibility assessment colors: ready, partial, blocked */
export const FEASIBILITY_COLORS: Record<string, StatusColorToken> = {
  ready: { color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' },
  partial: { color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
  blocked: { color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
};

import { CheckCircle, AlertTriangle, XCircle, type LucideIcon } from 'lucide-react';
import type { DesignTestResult } from '@/lib/types/designTypes';
import { FEASIBILITY_COLORS } from '@/lib/utils/designTokens';

interface DesignTestResultsProps {
  result: DesignTestResult;
}

const FEASIBILITY_META: Record<string, { icon: LucideIcon; label: string }> = {
  ready: { icon: CheckCircle, label: 'Ready' },
  partial: { icon: AlertTriangle, label: 'Partial' },
  blocked: { icon: XCircle, label: 'Blocked' },
};

export function DesignTestResults({ result }: DesignTestResultsProps) {
  const colors = FEASIBILITY_COLORS[result.overall_feasibility] ?? FEASIBILITY_COLORS.partial!;
  const meta = FEASIBILITY_META[result.overall_feasibility] ?? FEASIBILITY_META.partial!;
  const Icon = meta.icon;

  return (
    <div className="space-y-3 py-1">
      {/* Feasibility badge */}
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${colors.bgColor} border ${colors.borderColor}`}>
          <Icon className={`w-4 h-4 ${colors.color}`} />
          <span className={`text-sm font-medium ${colors.color}`}>{meta.label}</span>
        </div>
        <span className="text-xs text-muted-foreground/50">Feasibility Assessment</span>
      </div>

      {/* Confirmed capabilities */}
      {result.confirmed_capabilities.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-wider">
            Confirmed Capabilities
          </h4>
          <div className="space-y-1">
            {result.confirmed_capabilities.map((cap, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <span className="text-foreground/70">{cap}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues */}
      {result.issues.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-wider">
            Issues
          </h4>
          <div className="space-y-1">
            {result.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="text-foreground/70">{issue}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

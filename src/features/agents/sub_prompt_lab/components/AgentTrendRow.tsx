import { ArrowRight } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';

export interface AgentTrend {
  persona: Persona;
  errorRateDelta: number;
  currentRate: number;
}

interface AgentTrendRowProps {
  trend: AgentTrend;
  variant: 'improving' | 'degrading';
  onNavigate?: (id: string) => void;
}

export function AgentTrendRow({ trend, variant, onNavigate }: AgentTrendRowProps) {
  const delta = Math.abs(trend.errorRateDelta * 100).toFixed(1);
  return (
    <button
      onClick={() => onNavigate?.(trend.persona.id)}
      className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl hover:bg-secondary/40 transition-colors text-left group"
    >
      <span className="text-sm text-foreground/80 truncate flex-1">{trend.persona.name}</span>
      <span
        className={`text-sm font-mono ${
          variant === 'improving' ? 'text-emerald-400/80' : 'text-red-400/80'
        }`}
      >
        {variant === 'improving' ? '\u2212' : '+'}
        {delta}pp
      </span>
      <ArrowRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
    </button>
  );
}

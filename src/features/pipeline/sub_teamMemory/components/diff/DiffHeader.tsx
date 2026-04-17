import { useTranslation } from '@/i18n/useTranslation';
import { ArrowRight } from 'lucide-react';

interface DiffHeaderProps {
  runs: [string, number][];
  runA: string;
  runB: string;
  onRunAChange: (id: string) => void;
  onRunBChange: (id: string) => void;
}

function shortId(id: string) {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export default function DiffHeader({ runs, runA, runB, onRunAChange, onRunBChange }: DiffHeaderProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  return (
    <div className="flex items-center gap-1.5 px-1">
      <select
        value={runA}
        onChange={(e) => onRunAChange(e.target.value)}
        className="flex-1 text-xs bg-primary/5 border border-primary/10 rounded-card px-1.5 py-1 text-foreground focus-visible:outline-none focus-visible:border-violet-500/30 truncate"
      >
        <option value="" disabled>{pt.base_run}</option>
        {runs.map(([id, count]) => (
          <option key={id} value={id} disabled={id === runB}>
            {shortId(id)} ({count})
          </option>
        ))}
      </select>
      <ArrowRight className="w-3 h-3 text-foreground flex-shrink-0" />
      <select
        value={runB}
        onChange={(e) => onRunBChange(e.target.value)}
        className="flex-1 text-xs bg-primary/5 border border-primary/10 rounded-card px-1.5 py-1 text-foreground focus-visible:outline-none focus-visible:border-violet-500/30 truncate"
      >
        <option value="" disabled>{pt.compare_run}</option>
        {runs.map(([id, count]) => (
          <option key={id} value={id} disabled={id === runA}>
            {shortId(id)} ({count})
          </option>
        ))}
      </select>
    </div>
  );
}

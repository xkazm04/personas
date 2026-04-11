import { useState, useEffect } from 'react';
import { AlertTriangle, Zap, Clock, Link2, Radio, Loader2, History } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import type { BlastRadiusItem } from '@/api/agents/personas';

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  automation: Zap,
  trigger: Clock,
  subscription: Radio,
  execution: Loader2,
  chain: Link2,
  event: Radio,
  rotation: Clock,
  persona: AlertTriangle,
  status: AlertTriangle,
  run: Loader2,
  history: History,
};

interface BlastRadiusPanelProps {
  items: BlastRadiusItem[];
  loading?: boolean;
}

export function BlastRadiusPanel({ items, loading }: BlastRadiusPanelProps) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 typo-body text-foreground">
        <LoadingSpinner size="sm" />
        <span>{t.shared.blast_checking_impact}</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-3 py-2 typo-body text-foreground">
        {t.shared.blast_safe_to_delete}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400/80" />
        <span className="typo-heading text-amber-400/80">{t.shared.blast_impact}</span>
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => {
          const Icon = CATEGORY_ICONS[item.category] ?? AlertTriangle;
          return (
            <li key={i} className="flex items-start gap-2 px-2 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
              <Icon className="w-3.5 h-3.5 text-amber-400/70 mt-0.5 shrink-0" />
              <span className="typo-body text-foreground">{item.description}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Hook to fetch blast radius items on mount. */
export function useBlastRadius(
  fetcher: () => Promise<BlastRadiusItem[]>,
  enabled: boolean,
) {
  const [items, setItems] = useState<BlastRadiusItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled]);

  return { items, loading };
}

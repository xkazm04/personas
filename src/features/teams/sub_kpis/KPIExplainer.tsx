// First-run orientation banner for the KPIs hub (P5) — same pattern as the
// goals views' GoalViewExplainer: plain language, dismiss persists once.
import { useState } from 'react';
import { Info, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

const STORAGE_KEY = 'personas.kpis.explainer';

export function KPIExplainer() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (err) {
      silentCatch('KPIExplainer.read')(err);
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (err) {
      silentCatch('KPIExplainer.persist')(err);
    }
  };

  return (
    <div className="flex items-start gap-2 px-3 py-2 mb-4 rounded-card border border-primary/15 bg-primary/5">
      <Info className="w-3.5 h-3.5 text-primary/70 mt-0.5 flex-shrink-0" />
      <p className="typo-caption text-foreground flex-1">{t.kpis.explainer}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t.common.dismiss}
        title={t.common.dismiss}
        className="p-0.5 rounded text-foreground hover:opacity-70 transition-opacity flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

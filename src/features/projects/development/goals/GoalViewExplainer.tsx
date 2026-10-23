import { useState } from 'react';
import { Info, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

// Same key the per-view explainer used for Progress, so a dismissal carries over.
const STORAGE_KEY = 'personas.goals.explainer.progress';

/**
 * One-line "what this surface shows you" banner for Goals — first-run
 * orientation for non-technical users. Dismiss persists, so it shows once.
 */
export function GoalViewExplainer({ text }: { text: string }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (err) {
      silentCatch('GoalViewExplainer.read')(err);
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (err) {
      silentCatch('GoalViewExplainer.persist')(err);
    }
  };

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-card border border-primary/15 bg-primary/5">
      <Info className="w-3.5 h-3.5 text-primary/70 mt-0.5 flex-shrink-0" />
      <p className="typo-caption text-foreground flex-1">{text}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t.common.dismiss}
        title={t.common.dismiss}
        className="p-0.5 rounded text-foreground hover:text-foreground/70 transition-colors flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default GoalViewExplainer;

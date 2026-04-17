import { useEffect, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { useTwinTranslation } from './i18n/useTwinTranslation';

const STORAGE_PREFIX = 'twin.coachmarks.';

function storageKey(id: string): string {
  return `${STORAGE_PREFIX}${id}`;
}

/**
 * Inline dismissable hint card shown on first visit to a subtab.
 * Dismissal persists to localStorage so the coach mark never reappears
 * for that tab on this machine. Rendered by each subtab right below the
 * ContentHeader.
 *
 * All copy lives in `t.coach.*` — pass the translated title/body directly
 * so callers stay type-checked against the dictionary shape.
 */
export function CoachMark({ id, title, body }: { id: string; title: string; body: string }) {
  const { t } = useTwinTranslation();
  const [dismissed, setDismissed] = useState(true); // start dismissed; hydrate from storage in effect

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(id));
      setDismissed(raw === '1');
    } catch {
      setDismissed(false);
    }
  }, [id]);

  const handleDismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(storageKey(id), '1'); } catch { /* quota / private mode */ }
  };

  if (dismissed) return null;

  return (
    <div className="mb-4 p-3 rounded-card border border-violet-500/20 bg-violet-500/5 flex items-start gap-3" role="note">
      <div className="w-7 h-7 rounded-interactive bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
        <Lightbulb className="w-3.5 h-3.5 text-violet-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="typo-caption text-foreground font-medium">{title}</p>
        <p className="typo-caption text-foreground mt-0.5">{body}</p>
      </div>
      <button
        onClick={handleDismiss}
        aria-label={t.coach.dismiss}
        className="flex-shrink-0 px-2 py-1 text-[10px] font-medium rounded-interactive text-violet-400 hover:bg-violet-500/10 transition-colors"
      >
        {t.coach.dismiss}
        <X className="inline-block ml-1 w-3 h-3" />
      </button>
    </div>
  );
}

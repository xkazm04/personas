import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { StandupSource } from '../data/types';

/** Inline errors (Athena's two-surface doctrine: the page never speaks in toasts). */
export function StandupErrors({ source }: { source: StandupSource }) {
  const { t } = useTranslation();
  const lines = [source.errors.standup, source.errors.events, source.errors.action].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div role="alert" className="flex items-center gap-3 px-5 py-2 border-b border-primary/10">
      <div className="flex-1 min-w-0">{lines.map((l) => <p key={l} className="typo-body su-error">{l}</p>)}</div>
      {source.errors.action && <Button variant="ghost" size="sm" onClick={source.actions.clearError}>{t.athena.standup.dismiss}</Button>}
    </div>
  );
}

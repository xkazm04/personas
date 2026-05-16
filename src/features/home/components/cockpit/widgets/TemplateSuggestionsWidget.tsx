import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionMatchTemplates,
  type CompanionTemplateMatch,
} from '@/api/companion';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Inline chat-card Athena emits via `show_template_suggestions { intent }`.
 * Renders a small set (default 3, max 5) of templates the user might
 * adopt as a starting point for their described persona. The widget
 * fetches matches on mount via `companion_match_templates`; the
 * dispatcher only carries the intent string forward.
 *
 * Each result has an "Open template" affordance that navigates to the
 * design-reviews route, where the user can adopt it through the normal
 * adoption flow. No direct adoption from chat — that would bypass the
 * questionnaire and customization steps users expect.
 */
export function TemplateSuggestionsWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent =
    typeof config?.intent === 'string' ? (config.intent as string).trim() : '';
  const limit =
    typeof config?.limit === 'number' ? (config.limit as number) : 3;

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<CompanionTemplateMatch[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!intent) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    companionMatchTemplates(intent, limit)
      .then((rows) => {
        if (cancelled) return;
        setMatches(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        silentCatch('companion_match_templates')(err);
      });
    return () => {
      cancelled = true;
    };
  }, [intent, limit]);

  const openTemplates = () => {
    useSystemStore.getState().setSidebarSection('design-reviews');
  };

  return (
    <div
      className="rounded-card border border-sky-500/30 bg-sky-500/[0.04] p-4 space-y-3"
      data-testid="companion-template-suggestions-widget"
    >
      <header className="flex items-baseline gap-2 typo-caption text-sky-300/85">
        <BookOpen className="w-3.5 h-3.5" />
        <span className="font-medium">
          {title || t.plugins.companion.template_suggestions_title}
        </span>
        {intent && (
          <span className="text-foreground/55 truncate" title={intent}>
            · {intent}
          </span>
        )}
      </header>
      {loading && (
        <div className="flex items-center gap-2 typo-caption text-foreground/55">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{t.plugins.companion.template_suggestions_loading}</span>
        </div>
      )}
      {!loading && error && (
        <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 typo-caption text-rose-400">
          {error}
        </div>
      )}
      {!loading && !error && matches.length === 0 && (
        <div className="typo-caption text-foreground/55">
          {t.plugins.companion.template_suggestions_empty}
        </div>
      )}
      {!loading && matches.length > 0 && (
        <ul className="space-y-2">
          {matches.map((m) => (
            <li
              key={m.id}
              className="rounded-card border border-foreground/10 bg-secondary/40 p-3 space-y-1"
              data-template-id={m.id}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="typo-body font-medium text-foreground/95">
                  {m.name}
                </span>
                {m.category && (
                  <span className="typo-caption text-foreground/45 shrink-0">
                    {m.category}
                  </span>
                )}
              </div>
              <p className="typo-caption text-foreground/70 line-clamp-3">
                {m.snippet}
              </p>
              {m.connectors.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.connectors.map((c) => (
                    <span
                      key={c}
                      className="rounded-interactive bg-foreground/[0.06] border border-foreground/10 px-1.5 py-0.5 typo-caption text-foreground/65"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!loading && matches.length > 0 && (
        <button
          type="button"
          onClick={openTemplates}
          className="inline-flex items-center gap-1 typo-caption text-sky-300/85 hover:text-sky-300 rounded-interactive"
        >
          <span>{t.plugins.companion.template_suggestions_open_browse}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

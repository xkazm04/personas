import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionMatchTemplates,
  type CompanionTemplateMatch,
} from '@/api/companion';
import { KitButton, ListRow, Meta, Rows, Tile } from '@/features/shared/components/kit';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Inline chat-card Athena emits via `show_template_suggestions { intent }`.
 * Renders a small set (default 3, max 5) of templates the user might
 * adopt as a starting point for their described persona. The widget
 * fetches matches on mount via `companion_match_templates`; the
 * dispatcher only carries the intent string forward.
 *
 * One kit Tile: each result is a pressable kit row (the name is the row's
 * one button) that stashes its template id, switches the templates tab to the generated
 * gallery and routes to design-reviews, where the gallery opens that
 * template's detail modal and the user adopts it through the normal flow.
 * No direct adoption from chat - that would bypass the questionnaire and
 * customization steps users expect. The footer keeps the unfiltered browse.
 */
export function TemplateSuggestionsWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
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
        // Kept raw here and resolved at render into the product's sentence.
        const raw = err instanceof Error ? err.message : String(err);
        setError(raw);
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

  const openTemplate = (id: string) => {
    const sys = useSystemStore.getState();
    sys.setPendingTemplateId(id);
    sys.setTemplateTab('generated');
    sys.setSidebarSection('design-reviews');
  };

  const searched = !loading && !error && intent !== '';
  const failure = error ? resolveErrorTranslated(t, error) : null;
  return (
    <Tile
      span={span}
      title={title || t.athena.template_suggestions_title}
      actions={actions}
      count={matches.length > 0 ? matches.length : undefined}
      meta={intent || undefined}
      testId="companion-template-suggestions-widget"
      state={loading ? 'loading' : searched && matches.length === 0 ? 'empty' : undefined}
      ghostRows={2}
      empty={{ title: t.athena.template_suggestions_empty }}
      error={error ? { title: failure?.message, hint: failure?.suggestion } : undefined}
      footer={
        matches.length > 0 || footer ? (
          <>
            {matches.length > 0 && (
              <KitButton tone="quiet" icon={<ArrowRight />} onClick={openTemplates}>
                {t.athena.template_suggestions_open_browse}
              </KitButton>
            )}
            {footer}
          </>
        ) : undefined
      }
    >
      {/* Only a search that actually ran can report finding nothing (the
          `empty` state above needs an intent): with none the widget never
          queried, so "no templates" would be a claim about a catalog it never
          looked at. Each row IS the "Open template" control. */}
      {matches.length > 0 && (
        <Rows count={matches.length} empty={{ title: '' }}>
          {matches.map((m) => (
            <ListRow
              key={m.id}
              size="l"
              name={m.name}
              meta={<Meta parts={[m.category, m.snippet]} />}
              figures={m.connectors.length > 0 ? <span className="typo-caption k-quiet"><Meta parts={m.connectors} /></span> : undefined}
              onPress={() => openTemplate(m.id)}
              testId={`template-suggestion-${m.id}`}
            />
          ))}
        </Rows>
      )}
    </Tile>
  );
}

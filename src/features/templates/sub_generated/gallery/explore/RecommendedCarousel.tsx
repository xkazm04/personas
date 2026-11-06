import { Sparkles, Download } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/lib/connectors/connectorMeta';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useTranslation } from '@/i18n/useTranslation';

interface RecommendedCarouselProps {
  recommendedTemplates: PersonaDesignReview[];
  onSelectTemplate: (template: PersonaDesignReview) => void;
}

export function RecommendedCarousel({
  recommendedTemplates,
  onSelectTemplate,
}: RecommendedCarouselProps) {
  const { t } = useTranslation();
  if (recommendedTemplates.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-hair flex-shrink-0">
      <div className="flex items-center gap-2 mb-2.5">
        <Sparkles className="w-4 h-4 text-ink-3" />
        <SectionLabel as="span" className="mb-0">
          {t.templates.recommended.title}
        </SectionLabel>
        <span className="typo-body text-foreground">
          {t.templates.recommended.subtitle}
        </span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {recommendedTemplates.map((tmpl) => {
          const connectors: string[] = parseJsonOrDefault(tmpl.connectors_used, []);
          return (
            <button
              type="button"
              key={tmpl.id}
              onClick={() => onSelectTemplate(tmpl)}
              className="flex-shrink-0 w-[220px] p-3 rounded-modal bg-surface-1 border border-hair hover:border-hair-2 hover:bg-surface-2 hover:-translate-y-px transition-all text-left group/rec outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="typo-body text-foreground group-hover/rec:text-ink-1 truncate">
                {tmpl.test_case_name}
              </div>
              <div className="typo-body text-foreground truncate mt-0.5">
                {tmpl.instruction.length > 55 ? tmpl.instruction.slice(0, 55) + '...' : tmpl.instruction}
              </div>
              <div className="flex items-center gap-2 mt-2">
                {connectors.slice(0, 3).map((c) => {
                  const meta = getConnectorMeta(c);
                  return (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-body rounded-interactive bg-surface-2 text-foreground"
                      title={meta.label}
                    >
                      <ConnectorIcon meta={meta} size="w-3 h-3" />
                      {meta.label.length > 8 ? meta.label.slice(0, 8) + '..' : meta.label}
                    </span>
                  );
                })}
                {connectors.length > 3 && (
                  <span className="typo-body text-foreground">+{connectors.length - 3}</span>
                )}
                {tmpl.adoption_count > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 typo-data text-ink-2">
                    <Download className="w-2.5 h-2.5" />
                    {tmpl.adoption_count}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

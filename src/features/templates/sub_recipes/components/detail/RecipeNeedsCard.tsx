import { Plug, SlidersHorizontal } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/lib/connectors/connectorMeta';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import type { Recipe } from '../../types';

interface RecipeNeedsCardProps {
  recipe: Recipe;
}

/** "What it needs" card: required + optional connectors and the binding
 *  manifest the adoption wizard will collect. */
export function RecipeNeedsCard({ recipe }: RecipeNeedsCardProps) {
  const { t, tx } = useTranslation();

  return (
    <section className="rounded-card border border-card-border bg-secondary/30 p-4 shadow-elevation-1">
      <h4 className="typo-label uppercase tracking-wider text-foreground mb-3">
        {t.recipes_catalog.what_it_needs_heading}
      </h4>

      <div className="mb-4">
        <div className="typo-caption text-foreground mb-1.5">{t.recipes_catalog.required_connectors_heading}</div>
        <div className="flex flex-wrap gap-1.5">
          {recipe.requiredConnectors.map((slug) => {
            const m = getConnectorMeta(slug);
            return (
              <span
                key={slug}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded border bg-secondary/40"
                style={{ borderColor: m.color + '55' }}
              >
                <ConnectorIcon meta={m} size="w-3.5 h-3.5" />
                <span className="typo-caption font-medium" style={{ color: m.color }}>
                  {m.label}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {recipe.optionalConnectors.length > 0 && (
        <div className="mb-4">
          <div className="typo-caption text-foreground mb-1.5">
            {t.recipes_catalog.optional_connectors_heading} <span className="text-foreground">{t.recipes_catalog.optional_connectors_qualifier}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recipe.optionalConnectors.map((slug) => {
              const m = getConnectorMeta(slug);
              return (
                <span
                  key={slug}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-card-border/60 bg-secondary/30"
                >
                  <ConnectorIcon meta={m} size="w-3.5 h-3.5" />
                  <span className="typo-caption text-foreground">{m.label}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {(recipe.template.inputParameters?.length ?? 0) > 0 && (
        <div className="mb-4">
          <div className="typo-caption text-foreground mb-1.5">{t.recipes_catalog.parameters_heading}</div>
          <ul className="space-y-1">
            {recipe.template.inputParameters!.map((p) => (
              <li
                key={p.name}
                className="flex items-start gap-2 px-2 py-1.5 rounded border border-card-border/50 bg-secondary/20"
              >
                <SlidersHorizontal className="w-3 h-3 text-foreground mt-1 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="typo-caption font-mono font-medium text-foreground">{p.name}</span>
                    {p.type && (
                      <span className="typo-label uppercase tracking-wider text-foreground">{p.type}</span>
                    )}
                    {p.defaultValue && (
                      <span className="typo-label font-mono px-1 py-0.5 rounded border border-card-border/50 bg-secondary/30 text-foreground">
                        {t.recipes_catalog.param_default_label} {p.defaultValue}
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <div className="typo-caption text-foreground leading-snug">{p.description}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recipe.bindings.length > 0 && (
        <div>
          <div className="typo-caption text-foreground mb-1.5">
            {tx(recipe.bindings.length === 1 ? t.recipes_catalog.bindings_count_one : t.recipes_catalog.bindings_count_other, { count: recipe.bindings.length })}
          </div>
          <ul className="space-y-1">
            {recipe.bindings.map((b) => (
              <li
                key={b.variable}
                className="flex items-start gap-2 px-2 py-1.5 rounded border border-card-border/50 bg-secondary/20"
              >
                <Plug className="w-3 h-3 text-foreground mt-1 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="typo-caption font-medium text-foreground">{b.label}</span>
                    {b.required && (
                      <span className="typo-label uppercase tracking-wider text-status-warning/85">{t.common.required}</span>
                    )}
                    <span className="typo-label uppercase tracking-wider text-foreground">
                      {bindingKindLabel(b.kind.type, t)}
                    </span>
                  </div>
                  <div className="typo-caption text-foreground leading-snug">{b.description}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function bindingKindLabel(kind: string, t: Translations): string {
  switch (kind) {
    case 'slack-channel': return t.recipes_catalog.binding_kind_slack_channel;
    case 'google-drive-folder': return t.recipes_catalog.binding_kind_drive_folder;
    case 'google-calendar': return t.recipes_catalog.binding_kind_calendar;
    case 'github-repo': return t.recipes_catalog.binding_kind_github_repo;
    case 'email-address': return t.recipes_catalog.binding_kind_email;
    case 'cron': return t.recipes_catalog.binding_kind_cron;
    case 'enum': return t.recipes_catalog.binding_kind_enum;
    default: return kind;
  }
}

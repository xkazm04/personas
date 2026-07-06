import { Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { CONNECTOR_META, ConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { Archetype, MemoryStrategy } from '@/api/archetypes';
import type { Recipe } from '@/features/templates/sub_recipes/types';
import { foundryIcon } from './foundryIcons';

interface FoundryReviewProps {
  archetype: Archetype;
  memoryStrategy: MemoryStrategy;
  recipes: Recipe[];
  name: string;
  onNameChange: (v: string) => void;
  creating: boolean;
  onCreate: () => void;
}

/**
 * Review & create — the composition x-ray before the pipeline runs.
 * Shows the full recipe of the persona (foundation + capabilities +
 * connector requirements) so what gets created is never a surprise.
 * Connector readiness itself is resolved server-side at promote
 * (typed `setup_detail` blockers surface in the editor afterwards);
 * here we show WHAT will be needed, not whether it's wired yet.
 */
export function FoundryReview({
  archetype, memoryStrategy, recipes, name, onNameChange, creating, onCreate,
}: FoundryReviewProps) {
  const { t, tx } = useTranslation();
  const ArchIcon = foundryIcon(archetype.icon);
  const MemIcon = foundryIcon(memoryStrategy.icon);
  const connectors = [...new Set(recipes.flatMap((r) => r.requiredConnectors))];

  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
      {/* Name */}
      <div>
        <label htmlFor="foundry-name" className="typo-label uppercase tracking-wider text-foreground">
          {t.foundry.review_name_label}
        </label>
        <input
          id="foundry-name"
          data-testid="foundry-name-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={tx(t.foundry.review_name_placeholder, { archetype: archetype.name })}
          maxLength={60}
          className="mt-1 w-full px-3 py-2 rounded-input border border-card-border bg-secondary/40 typo-body text-foreground placeholder:text-foreground/45 focus:outline-none focus:border-primary/45 transition-colors"
        />
      </div>

      {/* Composition summary */}
      <div className="rounded-card border border-card-border/70 divide-y divide-card-border/50">
        <SummaryRow
          icon={<ArchIcon className="w-4 h-4" style={{ color: archetype.color }} />}
          iconBg={archetype.color}
          label={t.foundry.review_foundation_label}
          title={archetype.name}
          detail={archetype.tagline}
        />
        <SummaryRow
          icon={<MemIcon className="w-4 h-4 text-primary" />}
          label={t.foundry.review_memory_label}
          title={memoryStrategy.name}
          detail={memoryStrategy.whatItRemembers}
        />
        <div className="px-3 py-2.5">
          <div className="typo-label uppercase tracking-wider text-foreground mb-1.5">
            {tx(t.foundry.review_capabilities_label, { count: recipes.length })}
          </div>
          {recipes.length === 0 ? (
            <div className="typo-caption text-foreground">{t.foundry.review_no_capabilities}</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {recipes.map((r) => (
                <li key={r.id} className="typo-caption text-foreground/90 truncate">• {r.name}</li>
              ))}
            </ul>
          )}
        </div>
        {connectors.length > 0 && (
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5 typo-label uppercase tracking-wider text-status-warning mb-1.5">
              <TriangleAlert className="w-3 h-3" />
              {t.foundry.review_connectors_label}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {connectors.map((slug) => {
                const meta = CONNECTOR_META[slug];
                return (
                  <span key={slug} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-card-border/60 bg-secondary/40 typo-caption text-foreground">
                    {meta && <ConnectorIcon meta={meta} size="w-3 h-3" />}
                    {meta?.label ?? slug}
                  </span>
                );
              })}
            </div>
            <div className="typo-caption text-foreground mt-1.5">{t.foundry.review_connectors_hint}</div>
          </div>
        )}
        {memoryStrategy.requires.length > 0 && (
          <div className="px-3 py-2.5 typo-caption text-status-warning">
            {t.foundry.review_memory_setup_hint}
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid="foundry-create"
        disabled={creating || name.trim().length === 0}
        onClick={onCreate}
        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-interactive border border-primary/45 bg-primary/15 text-primary typo-body font-medium hover:bg-primary/25 shadow-elevation-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        style={{ borderColor: colorWithAlpha(archetype.color, 0.45) }}
      >
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {creating ? t.foundry.create_in_progress : t.foundry.create_button}
      </button>
    </div>
  );
}

function SummaryRow({ icon, iconBg, label, title, detail }: {
  icon: React.ReactNode; iconBg?: string; label: string; title: string; detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <span
        className="flex items-center justify-center rounded-card shrink-0 mt-0.5"
        style={{
          width: 30, height: 30,
          background: iconBg ? colorWithAlpha(iconBg, 0.14) : 'rgba(96,165,250,0.12)',
        }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="typo-label uppercase tracking-wider text-foreground">{label}</div>
        <div className="typo-body font-medium text-foreground">{title}</div>
        <div className="typo-caption text-foreground line-clamp-2">{detail}</div>
      </div>
    </div>
  );
}

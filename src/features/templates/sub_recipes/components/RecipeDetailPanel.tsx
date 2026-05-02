import {
  ArrowLeft, Sparkles, AlertTriangle, Lock, Calendar,
  Bell, Brain, UserCheck, Activity, Cpu, Plug,
} from 'lucide-react';
import { CONNECTOR_META, ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import type { Recipe } from '../types';
import { useRecipeEligibility } from '../useEligibility';
import { EligibilityChip } from './EligibilityChip';

interface RecipeDetailPanelProps {
  recipe: Recipe;
  onBack: () => void;
  onAdopt: () => void;
}

/**
 * Full-width recipe detail page. Layout:
 *
 *   ┌── back · brand-icon · name · eligibility chip · Adopt button ──┐
 *   │ Description (full)                                              │
 *   │                                                                 │
 *   │ ┌── What it does ─────────┬── What it needs ────────────────┐  │
 *   │ │ Trigger / Notifications │ Required + optional connectors  │  │
 *   │ │ + recipe-level policy   │ + bindings preview              │  │
 *   │ └─────────────────────────┴─────────────────────────────────┘  │
 *   └─────────────────────────────────────────────────────────────────┘
 */
export function RecipeDetailPanel({ recipe, onBack, onAdopt }: RecipeDetailPanelProps) {
  const { t, tx } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const eligibility = useRecipeEligibility(recipe);
  const iconKey = recipe.iconConnector ?? recipe.requiredConnectors[0] ?? null;
  const iconMeta = iconKey ? CONNECTOR_META[iconKey] ?? null : null;

  const canAdopt = !!selectedPersona && eligibility.state !== 'incompatible';

  return (
    <div className="flex flex-col h-full">
      {/* Header band */}
      <div className="flex items-start gap-3 px-4 py-3 border-b border-card-border/60 flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full border border-card-border bg-secondary/40 text-foreground/75 hover:text-foreground hover:border-primary/40 cursor-pointer transition-colors"
          title={t.recipes_catalog.back_to_catalog}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        {iconMeta && (
          <span
            className="shrink-0 flex items-center justify-center rounded-card mt-0.5"
            style={{
              width: 44, height: 44,
              background: `${iconMeta.color}1f`,
              border: `1px solid ${iconMeta.color}55`,
            }}
          >
            <ConnectorIcon meta={iconMeta} size="w-5 h-5" />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="typo-section-title text-foreground">{recipe.name}</span>
            <EligibilityChip eligibility={eligibility} />
            <span className="typo-label uppercase tracking-wider text-foreground/45 font-mono normal-case tracking-normal">
              v{recipe.version}
            </span>
          </div>
          <div className="typo-caption text-foreground/65 mt-0.5">{recipe.summary}</div>
          <div className="flex items-center gap-2 mt-1 typo-label uppercase tracking-wider text-foreground/45">
            <span>{recipe.category.replace(/-/g, ' ')}</span>
            <span className="text-foreground/30">·</span>
            <span>{tx(t.recipes_catalog.detail_by_prefix, { author: recipe.author })}</span>
            <span className="text-foreground/30">·</span>
            <span>{tx(t.recipes_catalog.detail_published_prefix, { date: recipe.publishedAt })}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onAdopt}
          disabled={!canAdopt}
          className={`shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-interactive border typo-body font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
            canAdopt
              ? 'border-primary/45 bg-primary/15 text-primary hover:bg-primary/25'
              : 'border-card-border bg-secondary/40 text-foreground/55'
          }`}
          title={
            !selectedPersona
              ? t.recipes_catalog.adopt_tooltip_no_persona
              : eligibility.state === 'incompatible'
                ? eligibility.reason
                : eligibility.state === 'adoptable-with-setup'
                  ? tx(t.recipes_catalog.adopt_tooltip_needs_setup, { count: eligibility.missingConnectors.length })
                  : t.recipes_catalog.adopt_tooltip_ready
          }
        >
          <Sparkles className="w-4 h-4" />
          {eligibility.state === 'adoptable-with-setup' ? t.recipes_catalog.adopt_with_setup_label : t.recipes_catalog.adopt_label}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* Eligibility banner — shown for adoptable-with-setup + incompatible */}
        {eligibility.state === 'adoptable-with-setup' && (
          <EligibilityBanner
            kind="setup"
            title={t.recipes_catalog.banner_setup_title}
            body={
              <>
                {t.recipes_catalog.banner_setup_body_prefix}{' '}
                {eligibility.missingConnectors.map((slug, i) => {
                  const m = getConnectorMeta(slug);
                  return (
                    <span key={slug} className="inline-flex items-center gap-1 mx-0.5">
                      <ConnectorIcon meta={m} size="w-3 h-3" />
                      <span className="font-medium" style={{ color: m.color }}>{m.label}</span>
                      {i < eligibility.missingConnectors.length - 1 && <span className="text-foreground/55">,</span>}
                    </span>
                  );
                })}{' '}
                {t.recipes_catalog.banner_setup_body_suffix}
              </>
            }
          />
        )}
        {eligibility.state === 'incompatible' && (
          <EligibilityBanner
            kind="locked"
            title={t.recipes_catalog.banner_locked_title}
            body={eligibility.reason}
          />
        )}

        {/* Description */}
        <div className="px-4 py-4">
          <h4 className="typo-label uppercase tracking-wider text-foreground/55 mb-2">{t.recipes_catalog.about_heading}</h4>
          <p className="typo-body text-foreground/90 leading-relaxed whitespace-pre-line">{recipe.description}</p>
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-6">
          {/* Left: what it does */}
          <section className="rounded-card border border-card-border bg-secondary/30 p-4">
            <h4 className="typo-label uppercase tracking-wider text-foreground/55 mb-3">{t.recipes_catalog.what_it_does_heading}</h4>
            <SpecRow icon={Calendar} label={t.recipes_catalog.spec_trigger_label}>
              {recipe.template.suggestedTrigger?.description ?? t.recipes_catalog.trigger_manual}
              {recipe.template.suggestedTrigger?.cron && (
                <span className="ml-2 typo-label font-mono text-foreground/55">
                  {recipe.template.suggestedTrigger.cron}
                </span>
              )}
            </SpecRow>
            <SpecRow icon={Bell} label={t.recipes_catalog.spec_notifications_label}>
              {recipe.template.notificationChannelTypes.length > 0
                ? recipe.template.notificationChannelTypes.join(', ')
                : <span className="text-foreground/55">{t.recipes_catalog.spec_notifications_none}</span>}
            </SpecRow>
            <SpecRow icon={Brain} label={t.recipes_catalog.spec_memory_label}>
              {policyLabel(recipe.template.generationSettings?.memories, 'on')}
            </SpecRow>
            <SpecRow icon={UserCheck} label={t.recipes_catalog.spec_review_label}>
              {policyLabel(recipe.template.generationSettings?.reviews, 'on')}
            </SpecRow>
            <SpecRow icon={Activity} label={t.recipes_catalog.spec_events_label}>
              {policyLabel(recipe.template.generationSettings?.events, 'on')}
            </SpecRow>
            {recipe.template.toolHints.length > 0 && (
              <SpecRow icon={Cpu} label={t.recipes_catalog.spec_tools_label}>
                <span className="font-mono typo-caption text-foreground/65">
                  {recipe.template.toolHints.slice(0, 3).join(', ')}
                  {recipe.template.toolHints.length > 3 && ` +${recipe.template.toolHints.length - 3}`}
                </span>
              </SpecRow>
            )}
          </section>

          {/* Right: what it needs */}
          <section className="rounded-card border border-card-border bg-secondary/30 p-4">
            <h4 className="typo-label uppercase tracking-wider text-foreground/55 mb-3">{t.recipes_catalog.what_it_needs_heading}</h4>

            {/* Required connectors */}
            <div className="mb-4">
              <div className="typo-caption text-foreground/65 mb-1.5">{t.recipes_catalog.required_connectors_heading}</div>
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
                <div className="typo-caption text-foreground/65 mb-1.5">
                  {t.recipes_catalog.optional_connectors_heading} <span className="text-foreground/45">{t.recipes_catalog.optional_connectors_qualifier}</span>
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
                        <span className="typo-caption text-foreground/75">{m.label}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bindings preview */}
            {recipe.bindings.length > 0 && (
              <div>
                <div className="typo-caption text-foreground/65 mb-1.5">
                  {tx(recipe.bindings.length === 1 ? t.recipes_catalog.bindings_count_one : t.recipes_catalog.bindings_count_other, { count: recipe.bindings.length })}
                </div>
                <ul className="space-y-1">
                  {recipe.bindings.map((b) => (
                    <li
                      key={b.variable}
                      className="flex items-start gap-2 px-2 py-1.5 rounded border border-card-border/50 bg-secondary/20"
                    >
                      <Plug className="w-3 h-3 text-foreground/45 mt-1 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="typo-caption font-medium text-foreground">{b.label}</span>
                          {b.required && (
                            <span className="typo-label uppercase tracking-wider text-status-warning/85">required</span>
                          )}
                          <span className="typo-label uppercase tracking-wider text-foreground/45">
                            {bindingKindLabel(b.kind.type, t)}
                          </span>
                        </div>
                        <div className="typo-caption text-foreground/65 leading-snug">{b.description}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        {/* Tags */}
        {recipe.tags.length > 0 && (
          <div className="px-4 pb-6">
            <div className="typo-label uppercase tracking-wider text-foreground/55 mb-1.5">{t.recipes_catalog.tags_heading}</div>
            <div className="flex flex-wrap gap-1">
              {recipe.tags.map((tag) => (
                <span
                  key={tag}
                  className="typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border border-card-border/60 bg-secondary/30 text-foreground/65"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface SpecRowProps {
  icon: typeof Calendar;
  label: string;
  children: React.ReactNode;
}

function SpecRow({ icon: Icon, label, children }: SpecRowProps) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-t border-card-border/40 first:border-t-0 first:pt-0">
      <Icon className="w-3.5 h-3.5 text-foreground/55 shrink-0 mt-0.5" />
      <span className="typo-caption text-foreground/65 w-24 shrink-0">{label}</span>
      <span className="flex-1 min-w-0 typo-caption text-foreground/90">{children}</span>
    </div>
  );
}

function policyLabel(value: string | undefined, defaultValue: string): React.ReactNode {
  const v = value ?? defaultValue;
  if (v === 'on') return <span className="text-status-success">ON</span>;
  if (v === 'off') return <span className="text-foreground/55">OFF</span>;
  if (v === 'trust_llm') return <span className="text-status-warning">TRUST</span>;
  return <span className="text-foreground/55">—</span>;
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

interface EligibilityBannerProps {
  kind: 'setup' | 'locked';
  title: string;
  body: React.ReactNode;
}

function EligibilityBanner({ kind, title, body }: EligibilityBannerProps) {
  const cls = kind === 'setup'
    ? 'border-status-warning/35 bg-status-warning/10'
    : 'border-card-border bg-secondary/40';
  const Icon = kind === 'setup' ? AlertTriangle : Lock;
  const iconCls = kind === 'setup' ? 'text-status-warning' : 'text-foreground/55';
  return (
    <div className={`mx-4 mt-4 px-3 py-2.5 rounded-card border ${cls} flex items-start gap-2`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconCls}`} />
      <div className="flex-1 min-w-0">
        <div className={`typo-label uppercase tracking-wider ${iconCls}`}>{title}</div>
        <div className="typo-caption text-foreground/85 mt-0.5">{body}</div>
      </div>
    </div>
  );
}

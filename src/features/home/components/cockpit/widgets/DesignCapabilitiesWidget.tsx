import {
  Activity,
  BookOpen,
  CheckCircle2,
  Compass,
  Cpu,
  Layers,
  ScrollText,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Onboarding card listing Athena's persona-design vocabulary. The card
 * itself is mostly static — what changes between emits is the optional
 * `intro` Athena composes for context. The 8 capability rows reflect
 * the actual ops registered in the dispatcher, so the user gets a true
 * picture of "what can you help me design?" instead of a model-generated
 * (and potentially hallucinated) capability list.
 *
 * Each row carries: icon, op name (human label), one-line behavior,
 * example user prompt that triggers it.
 *
 * Mirror this list when adding a new design-family op so the onboarding
 * surface stays current.
 */
export function DesignCapabilitiesWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intro = typeof config?.intro === 'string' ? config.intro.trim() : '';

  const rows: { icon: typeof Compass; label: string; behavior: string; example: string }[] = [
    {
      icon: Compass,
      label: t.plugins.companion.design_cap_walkthrough_label,
      behavior: t.plugins.companion.design_cap_walkthrough_behavior,
      example: t.plugins.companion.design_cap_walkthrough_example,
    },
    {
      icon: BookOpen,
      label: t.plugins.companion.design_cap_templates_label,
      behavior: t.plugins.companion.design_cap_templates_behavior,
      example: t.plugins.companion.design_cap_templates_example,
    },
    {
      icon: Layers,
      label: t.plugins.companion.design_cap_use_cases_label,
      behavior: t.plugins.companion.design_cap_use_cases_behavior,
      example: t.plugins.companion.design_cap_use_cases_example,
    },
    {
      icon: Zap,
      label: t.plugins.companion.design_cap_triggers_label,
      behavior: t.plugins.companion.design_cap_triggers_behavior,
      example: t.plugins.companion.design_cap_triggers_example,
    },
    {
      icon: Cpu,
      label: t.plugins.companion.design_cap_tier_label,
      behavior: t.plugins.companion.design_cap_tier_behavior,
      example: t.plugins.companion.design_cap_tier_example,
    },
    {
      icon: Activity,
      label: t.plugins.companion.design_cap_observability_label,
      behavior: t.plugins.companion.design_cap_observability_behavior,
      example: t.plugins.companion.design_cap_observability_example,
    },
    {
      icon: ScrollText,
      label: t.plugins.companion.design_cap_decision_log_label,
      behavior: t.plugins.companion.design_cap_decision_log_behavior,
      example: t.plugins.companion.design_cap_decision_log_example,
    },
    {
      icon: CheckCircle2,
      label: t.plugins.companion.design_cap_ready_label,
      behavior: t.plugins.companion.design_cap_ready_behavior,
      example: t.plugins.companion.design_cap_ready_example,
    },
  ];

  return (
    <div
      className="rounded-card border border-foreground/15 bg-secondary/40 p-4 space-y-3"
      data-testid="companion-design-capabilities-widget"
    >
      <header className="flex items-baseline gap-2 typo-caption text-foreground/80">
        <Sparkles className="w-3.5 h-3.5 text-amber-300/85" />
        <span className="font-medium">
          {title || t.plugins.companion.design_cap_title}
        </span>
      </header>
      {intro && (
        <p className="typo-body text-foreground/85 leading-relaxed">{intro}</p>
      )}
      <ul className="space-y-2">
        {rows.map((row, i) => {
          const Icon = row.icon;
          return (
            <li
              key={i}
              className="rounded-card border border-foreground/10 bg-secondary/50 p-2.5 space-y-1"
            >
              <div className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-foreground/55 shrink-0" />
                <span className="typo-body font-medium text-foreground/95">
                  {row.label}
                </span>
              </div>
              <p className="typo-caption text-foreground/70 pl-5">
                {row.behavior}
              </p>
              <p className="typo-caption text-foreground/45 pl-5 italic">
                {t.plugins.companion.design_cap_example_prefix} {row.example}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

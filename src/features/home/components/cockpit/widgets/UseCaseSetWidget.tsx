import { useMemo } from 'react';
import { CircleSlash, Layers, Sparkles, Target } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

interface UseCase {
  label: string;
  role: 'golden' | 'variant' | 'out_of_scope' | string;
  description: string;
}

/**
 * Inline chat-card Athena emits via `show_use_case_set { intent, use_cases }`.
 * Renders 3-5 proposed use cases tagged Golden / Variant / Out-of-scope,
 * applying the use-case decomposition rules from the persona-design
 * best-practices doctrine.
 *
 * Golden = the most common, most-valued input class (airtight).
 * Variant = known input shapes needing different handling.
 * Out-of-scope = inputs the persona should explicitly refuse.
 *
 * The set should cover all three roles — a persona with only Golden
 * cases breaks on its first edge-case input.
 */
export function UseCaseSetWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent =
    typeof config?.intent === 'string' ? (config.intent as string).trim() : '';
  const useCases = useMemo<UseCase[]>(() => {
    const raw = config?.use_cases;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((u): u is Record<string, unknown> => typeof u === 'object' && u !== null)
      .map((u) => ({
        label: typeof u.label === 'string' ? u.label : '',
        role: typeof u.role === 'string' ? (u.role as UseCase['role']) : 'variant',
        description: typeof u.description === 'string' ? u.description : '',
      }))
      .filter((u) => u.label.length > 0);
  }, [config]);

  if (useCases.length === 0) {
    return (
      <div className="rounded-card border border-foreground/10 bg-secondary/40 p-3 typo-caption text-foreground/55">
        {t.plugins.companion.use_case_set_empty}
      </div>
    );
  }

  // Sort golden → variant → out_of_scope so the card reads from "most
  // important to handle" down to "must refuse cleanly".
  const ordered = [...useCases].sort(
    (a, b) => roleRank(a.role) - roleRank(b.role),
  );

  return (
    <div
      className="rounded-card border border-amber-500/30 bg-amber-500/[0.04] p-4 space-y-3"
      data-testid="companion-use-case-set-widget"
    >
      <header className="flex items-baseline gap-2 typo-caption text-amber-300/85">
        <Layers className="w-3.5 h-3.5" />
        <span className="font-medium">
          {title || t.plugins.companion.use_case_set_title}
        </span>
        {intent && (
          <span className="text-foreground/55 truncate" title={intent}>
            · {intent}
          </span>
        )}
      </header>
      <ul className="space-y-2">
        {ordered.map((uc, i) => {
          const { Icon, roleLabel, accent } = roleVisuals(uc.role, t);
          return (
            <li
              key={`${uc.role}-${i}-${uc.label}`}
              className={`rounded-card border ${accent} p-3 space-y-1`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="typo-body font-medium text-foreground/95 flex-1">
                  {uc.label}
                </span>
                <span className="typo-caption text-foreground/55 shrink-0">
                  {roleLabel}
                </span>
              </div>
              {uc.description && (
                <p className="typo-caption text-foreground/70 leading-relaxed pl-5">
                  {uc.description}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function roleRank(role: string): number {
  if (role === 'golden') return 0;
  if (role === 'variant') return 1;
  return 2;
}

function roleVisuals(
  role: string,
  t: ReturnType<typeof useTranslation>['t'],
): {
  Icon: typeof Target;
  roleLabel: string;
  accent: string;
} {
  if (role === 'golden') {
    return {
      Icon: Target,
      roleLabel: t.plugins.companion.use_case_set_role_golden,
      accent: 'border-emerald-500/30 bg-emerald-500/[0.05]',
    };
  }
  if (role === 'out_of_scope') {
    return {
      Icon: CircleSlash,
      roleLabel: t.plugins.companion.use_case_set_role_out_of_scope,
      accent: 'border-rose-500/30 bg-rose-500/[0.05]',
    };
  }
  return {
    Icon: Sparkles,
    roleLabel: t.plugins.companion.use_case_set_role_variant,
    accent: 'border-violet-500/30 bg-violet-500/[0.05]',
  };
}

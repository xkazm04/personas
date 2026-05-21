import { useMemo } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Layers,
  Rocket,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { CockpitWidgetProps } from '../widgetRegistry';

type RecommendedAction = 'build_oneshot' | 'interactive' | 'use_template';

interface Summary {
  intent_line: string;
  system_prompt_outline?: string;
  use_cases?: string[];
  triggers?: string[];
  model_tier?: 'haiku' | 'sonnet' | 'opus' | string;
  observability?: string;
}

/**
 * Recap card emitted by `show_persona_ready { intent, summary, recommended_action }`.
 * Closes the design arc: pulls together the intent line, use cases,
 * triggers, model tier, and observability into one build-ready summary
 * with a prominent commit button.
 *
 * `recommended_action` drives the primary button shape:
 *   - `interactive`: routes to the standard prefill flow (autoLaunch=false)
 *   - `build_oneshot`: same prefill but with autoLaunch=true + one_shot mode
 *   - `use_template`: skip prefill, route the user to the template gallery
 *     to pick a starter (Athena should explain which one in the chat reply).
 */
export function PersonaReadyWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();

  const summary = useMemo<Summary | null>(() => {
    const raw = config?.summary;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const intent_line = typeof obj.intent_line === 'string' ? obj.intent_line : '';
    if (!intent_line) return null;
    return {
      intent_line,
      system_prompt_outline:
        typeof obj.system_prompt_outline === 'string'
          ? obj.system_prompt_outline
          : undefined,
      use_cases: Array.isArray(obj.use_cases)
        ? obj.use_cases.filter((u): u is string => typeof u === 'string')
        : undefined,
      triggers: Array.isArray(obj.triggers)
        ? obj.triggers.filter((u): u is string => typeof u === 'string')
        : undefined,
      model_tier:
        typeof obj.model_tier === 'string'
          ? (obj.model_tier as Summary['model_tier'])
          : undefined,
      observability:
        typeof obj.observability === 'string' ? obj.observability : undefined,
    };
  }, [config]);

  const recommended: RecommendedAction =
    typeof config?.recommended_action === 'string'
      ? (config.recommended_action as RecommendedAction)
      : 'interactive';

  if (!summary) {
    return (
      <div className="rounded-card border border-foreground/10 bg-secondary/40 p-3 typo-caption text-foreground">
        {t.plugins.companion.persona_ready_empty}
      </div>
    );
  }

  const handleCommit = () => {
    const sys = useSystemStore.getState();
    if (recommended === 'use_template') {
      sys.setSidebarSection('design-reviews');
      return;
    }
    const oneShot = recommended === 'build_oneshot';
    sys.setCompanionPrefill({
      intent: summary.intent_line,
      name: null,
      autoLaunch: oneShot,
      mode: oneShot ? 'one_shot' : 'interactive',
      companionSessionId: null,
    });
    sys.setSidebarSection('personas');
  };

  return (
    <div
      className="rounded-card border border-emerald-500/30 bg-emerald-500/[0.05] p-4 space-y-3"
      data-testid="companion-persona-ready-widget"
      data-recommended-action={recommended}
    >
      <header className="flex items-baseline gap-2 typo-caption text-emerald-300/85">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span className="font-medium">
          {title || t.plugins.companion.persona_ready_title}
        </span>
      </header>
      <div className="space-y-2">
        <div className="rounded-card bg-foreground/[0.04] border border-foreground/10 p-3">
          <div className="typo-caption text-foreground mb-1">
            {t.plugins.companion.persona_ready_intent_label}
          </div>
          <p className="typo-body text-foreground/95 leading-relaxed">
            {summary.intent_line}
          </p>
        </div>
        <Row
          icon={Sparkles}
          label={t.plugins.companion.persona_ready_prompt_outline}
          value={summary.system_prompt_outline}
        />
        <Row
          icon={Layers}
          label={t.plugins.companion.persona_ready_use_cases}
          value={summary.use_cases?.join(' · ')}
        />
        <Row
          icon={Zap}
          label={t.plugins.companion.persona_ready_triggers}
          value={summary.triggers?.join(' · ')}
        />
        <Row
          icon={Cpu}
          label={t.plugins.companion.persona_ready_model_tier}
          value={summary.model_tier}
        />
        <Row
          icon={Activity}
          label={t.plugins.companion.persona_ready_observability}
          value={summary.observability}
        />
      </div>
      <footer className="flex items-center justify-between gap-2 pt-1">
        <span className="typo-caption text-foreground">
          {recommendedHint(recommended, t)}
        </span>
        <button
          type="button"
          onClick={handleCommit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-emerald-500/85 hover:bg-emerald-500 text-emerald-950 typo-caption font-semibold focus-ring"
          data-testid="companion-persona-ready-commit"
        >
          <Rocket className="w-3.5 h-3.5" />
          <span>{commitButtonLabel(recommended, t)}</span>
        </button>
      </footer>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Layers;
  label: string;
  value: string | undefined;
}) {
  if (!value || !value.trim()) return null;
  return (
    <div className="flex items-baseline gap-2 typo-caption">
      <Icon className="w-3 h-3 text-foreground shrink-0 self-center" />
      <span className="text-foreground shrink-0">{label}</span>
      <span className="text-foreground/85 flex-1">{value}</span>
    </div>
  );
}

function recommendedHint(
  action: RecommendedAction,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (action === 'build_oneshot') {
    return t.plugins.companion.persona_ready_hint_oneshot;
  }
  if (action === 'use_template') {
    return t.plugins.companion.persona_ready_hint_template;
  }
  return t.plugins.companion.persona_ready_hint_interactive;
}

function commitButtonLabel(
  action: RecommendedAction,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (action === 'build_oneshot') {
    return t.plugins.companion.persona_ready_commit_oneshot;
  }
  if (action === 'use_template') {
    return t.plugins.companion.persona_ready_commit_template;
  }
  return t.plugins.companion.persona_ready_commit_interactive;
}

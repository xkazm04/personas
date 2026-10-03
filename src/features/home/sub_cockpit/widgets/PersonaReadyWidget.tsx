import { useMemo } from 'react';
import { Rocket } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { KeyValueGrid, KitButton, Stack, Tile, type KeyValueItem } from '@/features/shared/components/kit';
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
 * triggers, model tier, and observability into one build-ready summary:
 * one kit Tile whose facts are a KeyValueGrid (the refined intent first, on
 * its own line) and whose one call to action is the primary commit button.
 *
 * `recommended_action` drives the primary button shape:
 *   - `interactive`: routes to the standard prefill flow (autoLaunch=false)
 *   - `build_oneshot`: same prefill but with autoLaunch=true + one_shot mode
 *   - `use_template`: skip prefill, route the user to the template gallery
 *     to pick a starter (Athena should explain which one in the chat reply).
 */
export function PersonaReadyWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
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

  const heading = title || t.athena.persona_ready_title;
  if (!summary) {
    return <Tile span={span} title={heading} actions={actions} footer={footer} state="empty" empty={{ title: t.athena.persona_ready_empty }} />;
  }

  const handleCommit = () => {
    const sys = useSystemStore.getState();
    if (recommended === 'use_template') {
      sys.setSidebarSection('design-reviews');
      return;
    }
    const oneShot = recommended === 'build_oneshot';
    sys.setAthenaPrefill({
      intent: summary.intent_line,
      name: null,
      autoLaunch: oneShot,
      mode: oneShot ? 'one_shot' : 'interactive',
      companionSessionId: null,
    });
    sys.setSidebarSection('personas');
  };

  const facts: KeyValueItem[] = [
    { k: t.athena.persona_ready_prompt_outline, v: summary.system_prompt_outline },
    { k: t.athena.persona_ready_use_cases, v: summary.use_cases?.join(' · ') },
    { k: t.athena.persona_ready_triggers, v: summary.triggers?.join(' · ') },
    { k: t.athena.persona_ready_model_tier, v: summary.model_tier },
    { k: t.athena.persona_ready_observability, v: summary.observability },
  ].filter((f): f is { k: string; v: string } => typeof f.v === 'string' && f.v.trim() !== '');

  return (
    <Tile
      span={span}
      title={heading}
      actions={actions}
      footer={
        <>
          <KitButton tone="primary" icon={<Rocket />} onClick={handleCommit} testId="companion-persona-ready-commit">
            {commitButtonLabel(recommended, t)}
          </KitButton>
          {/* What the press does next (who decides, where it lands) is a consequence, not scaffolding. */}
          <span className="typo-caption k-quiet">{recommendedHint(recommended, t)}</span>
          {footer}
        </>
      }
    >
      <div data-testid="companion-persona-ready-widget" data-recommended-action={recommended}>
        {/* What it is, then what it is made of: two regions with a quiet rule between them
            (kit grow-4 Stack), not two grids run together. */}
        <Stack divided>
          <KeyValueGrid min="100%" items={[{ k: t.athena.persona_ready_intent_label, v: summary.intent_line }]} />
          {facts.length > 0 && <KeyValueGrid min="18rem" items={facts} />}
        </Stack>
      </div>
    </Tile>
  );
}

function recommendedHint(
  action: RecommendedAction,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (action === 'build_oneshot') {
    return t.athena.persona_ready_hint_oneshot;
  }
  if (action === 'use_template') {
    return t.athena.persona_ready_hint_template;
  }
  return t.athena.persona_ready_hint_interactive;
}

function commitButtonLabel(
  action: RecommendedAction,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (action === 'build_oneshot') {
    return t.athena.persona_ready_commit_oneshot;
  }
  if (action === 'use_template') {
    return t.athena.persona_ready_commit_template;
  }
  return t.athena.persona_ready_commit_interactive;
}

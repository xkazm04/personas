import { Rocket } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import { KitButton, Tile } from '@/features/shared/components/kit';
import { useSystemStore } from '@/stores/systemStore';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Long-form markdown card Athena emits via `show_persona_walkthrough`.
 * Carries her step-by-step design plan applied to the user's intent —
 * proposed intent line, system prompt outline, use case set, tools,
 * triggers — pulled from the persona-design best-practices doctrine.
 *
 * Unlike the dashboard-style widgets (persona_overview, decisions_panel,
 * etc.) this widget is meant to be READ, not glanced at: one kit Tile whose
 * height is its content (the page scrolls, never the card), the intent once
 * in the head's meta, and one primary "Build from this" in the footer.
 */
export function PersonaWalkthroughWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent =
    typeof config?.intent === 'string' ? (config.intent as string).trim() : '';
  const content =
    typeof config?.content === 'string' ? (config.content as string).trim() : '';
  const heading = title || t.athena.walkthrough_title;

  if (!content) {
    return <Tile span={span} title={heading} actions={actions} footer={footer} state="empty" empty={{ title: t.athena.walkthrough_empty }} />;
  }

  return (
    <Tile
      span={span}
      title={heading}
      meta={intent || undefined}
      testId="companion-walkthrough-widget"
      actions={actions}
      footer={
        intent || footer ? (
          <>
            {intent && (
              <KitButton tone="primary" icon={<Rocket />} onClick={() => commitWalkthroughToBuild(intent)} testId="companion-walkthrough-commit">
                {t.athena.walkthrough_commit_button}
              </KitButton>
            )}
            {footer}
          </>
        ) : undefined
      }
    >
      <div className="k-in typo-body [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-2">
        <MarkdownRenderer content={content} />
      </div>
    </Tile>
  );
}

/**
 * Frontend-side prefill commit. Mirrors what
 * `commands::companion::approvals::execute_prefill_persona_create`'s
 * ClientAction does after approval — the walkthrough card is itself a
 * suggestion (not an approval-bearing row), so it can fire the prefill
 * directly without round-tripping through the approval queue. Mode is
 * `interactive` (default) and autoLaunch is false; the user still drives
 * the build from UnifiedBuildEntry.
 */
function commitWalkthroughToBuild(intent: string) {
  const sys = useSystemStore.getState();
  sys.setAthenaPrefill({
    intent,
    name: null,
    autoLaunch: false,
    mode: 'interactive',
    companionSessionId: null,
  });
  sys.setSidebarSection('personas');
}

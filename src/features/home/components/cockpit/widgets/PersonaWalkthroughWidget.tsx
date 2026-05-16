import { Sparkles } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Long-form markdown card Athena emits via `show_persona_walkthrough`.
 * Carries her step-by-step design plan applied to the user's intent —
 * proposed intent line, system prompt outline, use case set, tools,
 * triggers — pulled from the persona-design best-practices doctrine.
 *
 * Unlike the dashboard-style widgets (persona_overview, decisions_panel,
 * etc.) this widget is meant to be READ, not glanced at. InlineChatCard
 * relaxes its height clamp for this kind so the walkthrough flows
 * naturally in the chat transcript instead of being scroll-trapped in a
 * 260px box.
 */
export function PersonaWalkthroughWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent =
    typeof config?.intent === 'string' ? (config.intent as string).trim() : '';
  const content =
    typeof config?.content === 'string' ? (config.content as string).trim() : '';

  if (!content) {
    return (
      <div className="rounded-card border border-foreground/10 bg-secondary/40 p-4 typo-caption text-foreground/50">
        {t.plugins.companion.walkthrough_empty}
      </div>
    );
  }

  return (
    <div
      className="rounded-card border border-violet-500/30 bg-violet-500/[0.04] p-4 space-y-3"
      data-testid="companion-walkthrough-widget"
    >
      <header className="flex items-baseline gap-2 typo-caption text-violet-300/85">
        <Sparkles className="w-3.5 h-3.5" />
        <span className="font-medium">
          {title || t.plugins.companion.walkthrough_title}
        </span>
        {intent && (
          <span className="text-foreground/55 truncate" title={intent}>
            · {intent}
          </span>
        )}
      </header>
      <div className="typo-body text-foreground/90 [&_h1]:typo-h3 [&_h2]:typo-h4 [&_h3]:typo-h5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-2 [&_code]:rounded-sm [&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:typo-caption">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
}

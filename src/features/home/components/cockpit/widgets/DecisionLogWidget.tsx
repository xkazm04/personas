import { useMemo } from 'react';
import { ChevronRight, GitBranch, ScrollText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

interface Decision {
  label: string;
  choice: string;
  rationale: string;
  timestamp?: string;
}

/**
 * Inline chat-card Athena emits via `show_decision_log { intent, decisions }`.
 * Captures the design choices made during the current conversation so
 * the user (and future-Athena) can retrace reasoning later without
 * re-running the conversation.
 *
 * Each decision row reads:
 *   <label>  →  <choice>
 *     · <rationale>
 *
 * Renders as a vertical timeline with a subtle accent rail — implies
 * causal sequence (the order matters) without forcing it visually.
 */
export function DecisionLogWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent =
    typeof config?.intent === 'string' ? (config.intent as string).trim() : '';
  const decisions = useMemo<Decision[]>(() => {
    const raw = config?.decisions;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (d): d is Record<string, unknown> => typeof d === 'object' && d !== null,
      )
      .map((d) => ({
        label: typeof d.label === 'string' ? d.label : '',
        choice: typeof d.choice === 'string' ? d.choice : '',
        rationale: typeof d.rationale === 'string' ? d.rationale : '',
        timestamp: typeof d.timestamp === 'string' ? d.timestamp : undefined,
      }))
      .filter((d) => d.label.length > 0 && d.choice.length > 0);
  }, [config]);

  if (decisions.length === 0) {
    return (
      <div className="rounded-card border border-foreground/10 bg-secondary/40 p-3 typo-caption text-foreground/55">
        {t.plugins.companion.decision_log_empty}
      </div>
    );
  }

  return (
    <div
      className="rounded-card border border-fuchsia-500/30 bg-fuchsia-500/[0.04] p-4 space-y-3"
      data-testid="companion-decision-log-widget"
    >
      <header className="flex items-baseline gap-2 typo-caption text-fuchsia-300/85">
        <ScrollText className="w-3.5 h-3.5" />
        <span className="font-medium">
          {title || t.plugins.companion.decision_log_title}
        </span>
        {intent && (
          <span className="text-foreground/55 truncate" title={intent}>
            · {intent}
          </span>
        )}
      </header>
      <ol className="relative space-y-3 pl-4">
        <span
          aria-hidden
          className="absolute left-1.5 top-1.5 bottom-1.5 w-px bg-fuchsia-500/20"
        />
        {decisions.map((d, i) => (
          <li
            key={`${d.label}-${i}`}
            className="relative space-y-1"
            data-decision-index={i}
          >
            <span
              aria-hidden
              className="absolute -left-[14px] top-1 w-2 h-2 rounded-full bg-fuchsia-500/45 ring-2 ring-fuchsia-500/20"
            />
            <div className="flex items-center gap-1.5 typo-caption text-foreground/85">
              <span className="font-medium">{d.label}</span>
              <ChevronRight className="w-3 h-3 text-foreground/35 shrink-0" />
              <span className="text-foreground/95">{d.choice}</span>
              {d.timestamp && (
                <span className="text-foreground/40 typo-caption ml-auto">
                  {prettyTime(d.timestamp)}
                </span>
              )}
            </div>
            {d.rationale && (
              <div className="flex items-baseline gap-1.5 typo-caption text-foreground/70">
                <GitBranch className="w-3 h-3 text-foreground/35 shrink-0" />
                <span className="leading-relaxed">{d.rationale}</span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Cheap timestamp render — full ISO is too noisy in a chip; we keep
 * just hh:mm if today, otherwise the full date. The widget doesn't
 * own a richer relative-time formatter, and the chat scroll already
 * implies recency.
 */
function prettyTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

import { Code2, Maximize2, Minimize2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Three tiny refinement chips rendered below the latest completed
 * assistant bubble. Each chip resends the previous user message with a
 * localized steering suffix, producing a new chat turn. Hidden while
 * streaming / improving — refining a reply that hasn't finished yet
 * would just race the current turn.
 *
 * Scope: only the LAST completed assistant bubble shows the chips. Older
 * bubbles don't (refining a scrollback turn is rare and a much higher-
 * effort UI to model well — the prior user prompt for an old bubble
 * isn't always trivially adjacent in `messages`).
 *
 * The chips call back into the panel's existing `send()` so the same
 * optimistic-bubble / streaming / TTS pipeline kicks in — no parallel
 * code path to drift.
 */
export function RefineChips({
  priorUserMessage,
  onSend,
  disabled,
}: {
  /** The user message that produced the latest assistant reply. */
  priorUserMessage: string;
  onSend: (text: string) => void;
  /** True while streaming, improving, or before init. */
  disabled: boolean;
}) {
  const { t } = useTranslation();

  if (!priorUserMessage.trim()) return null;

  const chips: { key: string; icon: typeof Code2; label: string; suffix: string }[] = [
    {
      key: 'shorter',
      icon: Minimize2,
      label: t.plugins.companion.refine_shorter,
      suffix: t.plugins.companion.refine_shorter_suffix,
    },
    {
      key: 'more_detail',
      icon: Maximize2,
      label: t.plugins.companion.refine_more_detail,
      suffix: t.plugins.companion.refine_more_detail_suffix,
    },
    {
      key: 'code_only',
      icon: Code2,
      label: t.plugins.companion.refine_code_only,
      suffix: t.plugins.companion.refine_code_only_suffix,
    },
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 pl-2"
      aria-label={t.plugins.companion.refine_label}
      data-testid="companion-refine-chips"
    >
      {chips.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.key}
            type="button"
            disabled={disabled}
            onClick={() => onSend(`${priorUserMessage}${c.suffix}`)}
            className="inline-flex items-center gap-1 rounded-interactive border border-foreground/15 bg-foreground/[0.04] hover:bg-foreground/[0.08] disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 typo-caption text-foreground/65 transition-colors"
          >
            <Icon className="w-3 h-3" />
            <span>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

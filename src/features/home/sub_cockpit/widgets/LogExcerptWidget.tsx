import { Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { intentTone, toneLabel } from './intentColors';

/**
 * `log_excerpt` — the evidence widget: a short monospace excerpt (log
 * lines, an error trace, a config snippet) with the lines that matter
 * highlighted and a caption saying what to notice. Athena uses it when
 * an explanation hinges on something the system actually said.
 *
 * Rendered as one kit Tile: the source is the head's meta, the excerpt is a code well at the
 * `typo-code` token size (no literal px), long lines wrap at word boundaries and break a token
 * only when it cannot fit, a highlighted line is tinted in the tone of its meaning with a rail
 * on its left edge, and the caption sits under the well. The height is the excerpt's.
 *
 * Config:
 *   {
 *     "lines": ["…", "…"],            // raw lines, keep under ~20
 *     "highlight_lines": [2, 3],       // 1-based indices to accent
 *     "highlight_intent": "bad",       // "warn" | "bad" — tint of the accent
 *     "caption": "The retry loop…",    // what to notice
 *     "source": "sentry · PERS-212"    // optional provenance label
 *   }
 */
export function LogExcerptWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const lines = Array.isArray(config?.lines) ? (config.lines as string[]) : [];
  const highlights = new Set(Array.isArray(config?.highlight_lines) ? (config.highlight_lines as number[]) : []);
  const tone = intentTone(config?.highlight_intent, 'warning');
  const caption = config?.caption as string | undefined;
  const source = config?.source as string | undefined;
  return (
    <Tile
      span={span}
      title={title ?? t.overview.cockpit.log_title}
      meta={source ? <span className="typo-code k-ellipsis">{source}</span> : undefined}
      actions={actions}
      footer={footer}
      state={lines.length === 0 ? 'empty' : undefined}
      empty={{ title: t.overview.cockpit.widget_empty }}
      testId="cockpit-log-excerpt"
    >
      <div className="k-in flex flex-col gap-2">
        <pre className={`typo-code rounded-input bg-background/60 py-1.5 m-0 t-${tone}`}>
          {lines.map((line, i) => {
            const hot = highlights.has(i + 1);
            return (
              <div
                key={i}
                className={`flex gap-2.5 px-2.5 border-l-2 ${hot ? 'border-l-[color:var(--tone)] bg-[color-mix(in_srgb,var(--tone)_12%,transparent)]' : 'border-l-transparent'}`}
              >
                <span className="select-none w-6 text-right shrink-0 k-quiet" aria-hidden>{i + 1}</span>
                <span className={`whitespace-pre-wrap break-words min-w-0 ${hot ? 'text-foreground' : ''}`}>
                  {hot && <span className="sr-only">{toneLabel(t, tone)}: </span>}
                  {line || ' '}
                </span>
              </div>
            );
          })}
        </pre>
        {caption && <p className="typo-caption m-0">{caption}</p>}
      </div>
    </Tile>
  );
}

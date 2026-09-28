import { ContextCard, ContextCards, Dot, Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { intentTone, toneLabel } from './intentColors';

/**
 * `comparison_cards` — the decision's options side-by-side with pros,
 * cons, and a recommended badge. Athena reaches for this when the user
 * is weighing 2-3 paths (approve vs reject, retry vs rollback) and the
 * trade-offs deserve more structure than prose.
 *
 * Rendered as one kit Tile of kit ContextCards (few peers, so cards): an option's meaning is the
 * Mark on its rail, the recommended option is the selected card (its rail lit in the theme's
 * primary glow) with "Recommended" leading its meta, and its advantages and drawbacks are the
 * card's meta as a list with a success or warning dot, under the head (the kit card has no body
 * slot and its foot is for figures; see the report's kit gap). Cards in a row share a height.
 *
 * Config:
 *   {
 *     "options": [
 *       {
 *         "label": "Approve",               // required
 *         "summary": "Run the persona…",    // optional one-liner
 *         "pros": ["…"],                    // optional
 *         "cons": ["…"],                    // optional
 *         "recommended": true,              // lights the card
 *         "intent": "good"                  // "good" | "warn" | "bad" | "info"
 *       }
 *     ]
 *   }
 */
interface ComparisonOption {
  label: string;
  summary?: string;
  pros?: string[];
  cons?: string[];
  recommended?: boolean;
  intent?: 'good' | 'warn' | 'bad' | 'info';
}

function Points({ items, side, tone }: { items?: string[]; side: string; tone: 'success' | 'warning' }) {
  if (!items?.length) return null;
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-1 w-full">
      {items.map((p, j) => (
        <li key={j} className="flex items-baseline gap-2">
          <Dot tone={tone} glyph={tone === 'success' ? 'soft' : 'hollow'} />
          <span className="min-w-0"><span className="sr-only">{side}: </span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

export function ComparisonCardsWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const c = t.overview.cockpit;
  const options = Array.isArray(config?.options) ? (config.options as ComparisonOption[]) : [];
  return (
    <Tile
      span={span}
      title={title}
      actions={actions}
      footer={footer}
      state={options.length === 0 ? 'empty' : undefined}
      empty={{ title: c.widget_empty }}
      testId="cockpit-comparison-cards"
    >
      <ContextCards label={title ?? options.map((o) => o.label).join(' / ')} min="15rem">
        {options.map((opt, i) => {
          const tone = opt.recommended ? 'primary' : intentTone(opt.intent, 'info');
          return (
            <ContextCard
              key={`${i}-${opt.label}`}
              title={opt.label}
              state={opt.recommended ? 'selected' : undefined}
              mark={{ tone, glyph: opt.recommended ? 'solid' : 'soft', label: opt.recommended ? c.comparison_recommended : toneLabel(t, tone) }}
              meta={(
                <div className="flex flex-col gap-1.5 w-full">
                  {(opt.recommended || opt.summary) && (
                    <span>
                      {opt.recommended && <span className="k-tint">{c.comparison_recommended}</span>}
                      {opt.recommended && opt.summary && ' · '}
                      {opt.summary}
                    </span>
                  )}
                  <Points items={opt.pros} side={c.comparison_pro} tone="success" />
                  <Points items={opt.cons} side={c.comparison_con} tone="warning" />
                </div>
              )}
            />
          );
        })}
      </ContextCards>
    </Tile>
  );
}

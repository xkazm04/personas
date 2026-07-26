/**
 * @catalog Accept/reject control shared by every decision surface (review, backlog, knowledge).
 *
 * One control, one colour language, three streams. Before this, Manual Review
 * used emerald/red overlay pills, the backlog used an emerald accent Button
 * beside a ghost, and the knowledge library used a primary Button beside a
 * ghost — same act, three looks. Tone (`accept` / `reject` / `neutral`) decides
 * the styling, so a caller can never invent a fourth.
 *
 * Manual Review is the reference path, so `accept` keeps its emerald accent and
 * `reject` stays quiet until hover — a destructive-looking reject button makes
 * reviewers hesitate on a queue they are supposed to burn down.
 */
import Button from '../buttons/Button';
import type { DecisionAction } from './decisionTypes';

const TONE_PROPS = {
  accept: { variant: 'accent', accentColor: 'emerald' },
  reject: { variant: 'ghost' },
  neutral: { variant: 'ghost' },
} as const;

export function DecisionActions({
  actions,
  size = 'sm',
  /** `stacked` fills the width — for a margin rail or a narrow column. */
  layout = 'inline',
  className,
}: {
  actions: DecisionAction[];
  size?: 'xs' | 'sm' | 'md';
  layout?: 'inline' | 'stacked';
  className?: string;
}) {
  if (actions.length === 0) return null;
  const stacked = layout === 'stacked';

  return (
    <div
      className={`flex ${stacked ? 'flex-col' : 'items-center'} gap-1.5 ${className ?? ''}`.trim()}
    >
      {actions.map((a) => {
        const tone = TONE_PROPS[a.tone];
        return (
          <Button
            key={a.id}
            size={size}
            variant={tone.variant}
            accentColor={'accentColor' in tone ? tone.accentColor : undefined}
            icon={a.icon}
            block={stacked}
            loading={a.loading}
            disabled={a.disabled}
            onClick={a.onClick}
            title={a.title ?? a.label}
            // Icons go through the `icon` prop and the label stays nowrap —
            // passing both as children puts them in one span, where they reflow
            // as inline content and split the button across two rows.
            className={`whitespace-nowrap ${
              a.tone === 'reject' ? 'hover:text-status-error' : ''
            }`.trim()}
          >
            {a.label}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * A gate's control surface: the native container for one waiting item, opened
 * from its gate on the spine or the board and tied back to that gate by a
 * leader line. Its head reads what kind of call it is, whose lane it blocks and
 * since when, and where it sits in the queue; Left / Right walk the queue, Esc
 * folds back to the timeline. The body is `SurfaceBody` (question, key pad,
 * Athena's backlit pick).
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { ArrowLeft, ArrowRight } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { WorkItem } from '../../../useWorkforce';
import { R5B_COPY as C } from './copy';
import { Cap } from './KeyPad';
import { SurfaceBody } from './SurfaceBody';
import { isTyping } from './useSurfaceKeys';

export function ControlSurface({
  items,
  item,
  where,
  width,
  animate,
  onFocus,
  onFold,
  onSend,
}: {
  items: WorkItem[];
  item: WorkItem;
  /** The lane the gate blocks (a run's name, or Athena). */
  where: string;
  width: number;
  animate: boolean;
  onFocus: (id: string) => void;
  onFold: () => void;
  onSend: (text: string) => void;
}) {
  const at = Math.max(0, items.findIndex((i) => i.id === item.id));
  const step = (d: 1 | -1) => items.length > 1 && onFocus(items[(at + d + items.length) % items.length]!.id);

  useAppKeyboard(
    (e) => {
      const el = document.activeElement;
      if (e.key === 'Escape') {
        if (el && isTyping(el) && (el as HTMLInputElement).value) return false;
        e.preventDefault();
        onFold();
        return true;
      }
      if (isTyping(el) || e.altKey || e.ctrlKey || e.metaKey) return false;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && items.length > 1) {
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
        return true;
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );

  return (
    <section
      key={item.id}
      className="r5b-console r5b-enter rounded-modal shadow-elevation-4 pointer-events-auto flex flex-col max-h-full min-h-0"
      style={{ width }}
      role="region"
      aria-label={`${C.gateKind[item.kind]}: ${where}`}
      data-testid="companion-r5b-surface"
    >
      <header className="flex items-start gap-4 px-6 pt-4 pb-3 r5b-rule-b">
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <p className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="r5b-glyph text-status-warning" aria-hidden />
            <span className="typo-code uppercase text-status-warning">{C.gateKind[item.kind]}</span>
            {item.createdAtMs > 0 && <RelativeTime timestamp={item.createdAtMs} className="typo-code text-muted" />}
          </p>
          <p className="typo-code text-foreground [overflow-wrap:anywhere]">{where}</p>
        </div>
        <span className="typo-code text-foreground tabular-nums whitespace-nowrap pt-1.5">{C.queueOf(at + 1, items.length)}</span>
        <span className="inline-flex gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} disabled={items.length < 2} aria-label={C.prev} aria-keyshortcuts="ArrowLeft">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => step(1)} disabled={items.length < 2} aria-label={C.next} aria-keyshortcuts="ArrowRight">
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="xs" onClick={onFold} aria-label={C.fold} aria-keyshortcuts="Escape" data-testid="companion-r5b-surface-fold">
            <Cap>Esc</Cap>
          </Button>
        </span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 pt-4 pb-5">
        <SurfaceBody item={item} animate={animate} onSend={onSend} />
      </div>
    </section>
  );
}

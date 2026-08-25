import { Folder, Wand2, X } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { FLEET_STATE_META } from '../fleetStateMeta';
import type { QuickDispatchController } from './quickDispatchController';

/**
 * Shared leaf pieces used by every Quick Dispatch variant — hoisted the moment
 * a second variant existed so a refinement lands once, not per variant.
 */

/** The `@project` / `/skill` chip pair. Pure render of controller state. */
export function QuickDispatchChips({ c }: { c: QuickDispatchController }) {
  const { quickT, tx } = c;
  if (!c.projectChip && !c.skillChip) return null;
  return (
    <>
      {c.projectChip && (
        <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 typo-caption rounded-full border bg-primary/10 border-primary/20 text-primary">
          <Folder className="w-3 h-3" aria-hidden="true" />
          {c.projectChip.name}
          <button
            type="button"
            onClick={c.removeProjectChip}
            aria-label={tx(quickT.chip_remove, { label: c.projectChip.name })}
            className="ml-0.5 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
          >
            <X className="w-2.5 h-2.5" aria-hidden="true" />
          </button>
        </span>
      )}
      {c.skillChip && (
        <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 typo-caption rounded-full border bg-violet-500/10 border-violet-500/20 text-violet-300">
          <Wand2 className="w-3 h-3" aria-hidden="true" />
          {`/${c.skillChip.name}`}
          <button
            type="button"
            onClick={c.removeSkillChip}
            aria-label={tx(quickT.chip_remove, { label: c.skillChip.name })}
            className="ml-0.5 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
          >
            <X className="w-2.5 h-2.5" aria-hidden="true" />
          </button>
        </span>
      )}
    </>
  );
}

/** One recent-dispatch row: state dot + label + relative time. */
export function RecentDispatchRow({
  c,
  session,
}: {
  c: QuickDispatchController;
  session: QuickDispatchController['recent'][number];
}) {
  const meta = FLEET_STATE_META.find((m) => m.id === session.state);
  return (
    <button
      type="button"
      onClick={c.openFleetPage}
      aria-label={c.quickT.recent_open_aria}
      className="w-full flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-foreground/[0.04] transition-colors text-left"
      data-testid="quick-dispatch-recent-row"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta?.dot ?? 'bg-zinc-500'}`}
        aria-hidden="true"
      />
      <span className="typo-caption text-foreground truncate">
        {session.title ?? session.name ?? session.projectLabel}
      </span>
      <RelativeTime
        timestamp={Number(session.lastActivityMs)}
        showTooltip={false}
        className="ml-auto shrink-0 typo-caption text-foreground"
      />
    </button>
  );
}

/**
 * The one reserved meta line every variant renders under its input: a single
 * fixed-height slot that SWAPS text between the syntax hint, the headless
 * caption, the success announcement and the error — never mounts/unmounts.
 * This is half of the anti-shake contract (the other half is keeping volatile
 * panels out of document flow). The live region stays permanently mounted
 * (screen-reader-announcements golden path).
 */
export function QuickDispatchMetaLine({ c }: { c: QuickDispatchController }) {
  const { quickT } = c;
  const error = c.translatedError;
  return (
    <div className="min-h-5 flex items-center" aria-live="off">
      {error ? (
        <p className="typo-caption text-red-400 truncate" role="alert" data-testid="quick-dispatch-error">
          {error.message} {error.suggestion}
        </p>
      ) : c.headless ? (
        <p className="typo-caption text-foreground truncate" data-testid="quick-dispatch-headless-caption">
          {quickT.headless_caption}
        </p>
      ) : !c.justDispatched ? (
        <p className="typo-caption text-foreground truncate">{quickT.syntax_hint}</p>
      ) : null}
      <p
        className={c.justDispatched && !error ? 'typo-caption text-emerald-300 truncate' : 'sr-only'}
        role="status"
        data-testid="quick-dispatch-success"
      >
        {c.justDispatched && !error ? quickT.dispatched : ''}
      </p>
    </div>
  );
}

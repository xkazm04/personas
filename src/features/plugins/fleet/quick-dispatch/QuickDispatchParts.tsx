import { Folder, Wand2, X } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { FLEET_STATE_META } from '../fleetStateMeta';
import type { QuickDispatchController } from './quickDispatchController';
import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons';

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
        <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 typo-caption rounded-interactive border bg-surface-1 border-hair text-primary">
          <Folder className="w-3 h-3" aria-hidden="true" />
          {c.projectChip.name}
          <Button variant="ghost" size="icon-sm"
            type="button"
            onClick={c.removeProjectChip}
            aria-label={tx(quickT.chip_remove, { label: c.projectChip.name })}
            className="ml-0.5"
          >
            <X className="w-2.5 h-2.5" aria-hidden="true" />
          </Button>
        </span>
      )}
      {c.skillChip && (
        <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 typo-caption rounded-interactive border bg-surface-1 border-hair text-role-agent">
          <Wand2 className="w-3 h-3" aria-hidden="true" />
          {`/${c.skillChip.name}`}
          <Button variant="ghost" size="icon-sm"
            type="button"
            onClick={c.removeSkillChip}
            aria-label={tx(quickT.chip_remove, { label: c.skillChip.name })}
            className="ml-0.5"
          >
            <X className="w-2.5 h-2.5" aria-hidden="true" />
          </Button>
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
    <PressSurface
      onPress={c.openFleetPage}
      aria-label={c.quickT.recent_open_aria}
      data-testid="quick-dispatch-recent-row"
      className="w-full flex items-center gap-2 px-1.5 py-1 rounded-interactive"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta?.dot ?? 'bg-surface-2'}`}
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
    </PressSurface>
  );
}

/**
 * The one reserved meta line every variant renders under its input: a single
 * fixed-height slot that SWAPS text between the headless caption, the success
 * announcement and the error — never mounts/unmounts. The `@` / `/` syntax
 * hint used to sit here too; since 2026-09-17 it lives in the input's own
 * placeholder, where it reads before the operator starts typing rather than
 * under a line they already committed to.
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
        <p className="typo-caption text-status-error truncate" role="alert" data-testid="quick-dispatch-error">
          {error.message} {error.suggestion}
        </p>
      ) : c.headless ? (
        <p className="typo-caption text-foreground truncate" data-testid="quick-dispatch-headless-caption">
          {quickT.headless_caption}
        </p>
      ) : null}
      <p
        className={c.justDispatched && !error ? 'typo-caption text-status-success truncate' : 'sr-only'}
        role="status"
        data-testid="quick-dispatch-success"
      >
        {c.justDispatched && !error ? quickT.dispatched : ''}
      </p>
    </div>
  );
}

// DockAthenaToggle — the Launch Rail's Athena grant, armed BEFORE the launch.
//
// Every other place in the app flags a session for Athena after it exists (the
// session menu's verb, the persona menu's bulk tri-state). The operator asked
// for it at the dock, which is a different thing: the grant has to be decided
// while the dispatch is still a draft and then land on whatever the dispatch
// turns into, started or queued.
//
// ## What the control promises
//
// Not "Athena flag". The grant's real effect is the autoapprove scope in
// `approval_autopilot.rs::GRANT_SCOPED_FLEET_ACTIONS` — `fleet_send_input`,
// `fleet_intervene`, `fleet_wake` and `fleet_kill` may fire on THIS session
// with no approval click. The tooltip says that in the operator's terms,
// including the part they cared about most: she can kill the process at the
// end. A tooltip reading "Athena flag" would name the row, not the grant.
//
// ## The state treatment is not this file's invention
//
// `AthenaGlyph` has no `filled` prop on purpose: measured on the 16/20/24/48px
// ladder, a stroke-weight change was invisible at the only size that matters.
// `CompanionMark` is the caller that solved it — ON is the glyph knocked out of
// a filled chip, OFF is the bare glyph in the row's ink, and never opacity.
// This control reuses that component rather than re-deciding it.
//
// Rendered inside the dock's reserved 34px instrument row, at the same 24px
// pill height as the headless switch beside it, so arming it moves nothing.

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { CompanionMark } from './prototype/entry-e/CompanionMark';

export function DockAthenaToggle({ armed, onToggle, disabled, remote }: {
  armed: boolean;
  onToggle: () => void;
  /** A dispatch is in flight: the grant is already decided for it. */
  disabled?: boolean;
  /**
   * The dispatch is bound for a paired device. There is no session in THIS
   * fleet to hold a grant, so the control is off the table and says why
   * rather than arming something that could only ever fail.
   */
  remote?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip
      content={
        remote
          ? t.monitor.grid_dock_athena_remote
          : armed ? t.monitor.grid_dock_athena_on : t.monitor.grid_dock_athena_off
      }
      placement="top"
    >
      <Button
        variant="ghost"
        size="xs"
        onClick={onToggle}
        disabled={disabled || remote}
        aria-label={t.monitor.grid_dock_athena_label}
        aria-pressed={armed && !remote}
        data-testid="quick-dispatch-athena-toggle"
        className={`typo-label flex h-6 flex-shrink-0 items-center gap-1.5 rounded-pill border px-2 ${
          armed && !remote
            ? 'border-primary/55 bg-primary/10 text-primary'
            : `border-card-border bg-card-bg text-foreground hover:border-primary/45 [[data-theme^='light']_&]:border-primary/35 [[data-theme^='light']_&]:bg-secondary/50`
        }`}
      >
        <CompanionMark companion="athena" active={armed && !remote} />
        {/* Her name, from the key the channels surface already owns: a brand
            name is the same byte string in all 14 locales and the untranslated
            gate allowlists exactly that one, not a second copy of it. */}
        <span>{t.monitor.channels_author_athena}</span>
      </Button>
    </Tooltip>
  );
}

export default DockAthenaToggle;

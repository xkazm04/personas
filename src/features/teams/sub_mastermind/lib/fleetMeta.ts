// Fleet session state labels, shared by every Mastermind surface that names one.
import type { Translations } from '@/i18n/generated/types';

/** Session state → the Fleet grid's own translated labels. Never render the raw
 *  machine token (CLAUDE.md status-token rule); an unrecognised state falls
 *  through to itself, which is honest rather than blank. Lives here rather than
 *  in one panel because every canvas surface that names a session state has to
 *  name it the same way. */
export const fleetStateLabel = (t: Translations, s: string): string =>
  ({
    spawning: t.plugins.fleet.state_spawning,
    running: t.plugins.fleet.state_working,
    awaiting_input: t.plugins.fleet.state_awaiting_input,
    idle: t.plugins.fleet.state_idle,
    stale: t.plugins.fleet.state_stale,
    hibernated: t.plugins.fleet.state_hibernated,
    exited: t.plugins.fleet.state_exited,
  })[s] ?? s;

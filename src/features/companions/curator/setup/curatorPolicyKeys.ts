/**
 * The nine `app_settings` rows `CuratorPolicy` is projected from.
 *
 * Mirrored from `settings_keys.rs`, which is the source of truth: each one is
 * on the Rust allow-list AND carries a validator, so an out-of-set level or a
 * negative cap is refused at the door rather than clamped on read. There is no
 * second setter - everything here goes through `set_app_setting`.
 *
 * **A BLANK value means "no ceiling declared", and the validator accepts it.**
 * That is not the same as a cap of zero: a zero budget is a companion that may
 * never run, and the four caps have no default constant on the Rust side for
 * exactly this reason. Clearing a field writes `""`, which reads back as null.
 */
export const CURATOR_LEVEL_RESEARCH = 'curator_level_research';
export const CURATOR_LEVEL_FORGE = 'curator_level_forge';
export const CURATOR_LEVEL_CONFORM = 'curator_level_conform';
export const CURATOR_LEVEL_SWEEP = 'curator_level_sweep';
export const CURATOR_DAILY_BUDGET_USD = 'curator_daily_budget_usd';
export const CURATOR_DAILY_RUN_CAP = 'curator_daily_run_cap';
export const CURATOR_DAILY_COMMIT_CAP = 'curator_daily_commit_cap';
export const CURATOR_QUIET_HOURS = 'curator_quiet_hours';
export const CURATOR_BACKPRESSURE_N = 'curator_backpressure_n';
export const CURATOR_WORKER_CAP = 'curator_worker_cap';

/** `settings_keys::CURATOR_BACKPRESSURE_N_MAX` - past this it is not backpressure. */
export const BACKPRESSURE_MAX = 100;
/**
 * `settings_keys::CURATOR_WORKER_CAP_MAX`. The registry's own librarian caps a
 * dispatch fan-out at 10 concurrent workers; this app must not exceed it.
 */
export const WORKER_CAP_MAX = 10;

/** The four authority levels, in order. `L0` is always asked. */
export const LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;

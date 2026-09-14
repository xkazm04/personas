// The Autopilot steppers' keys and bounds. Every number here exists twice —
// enforced in `src-tauri/db/src/settings_keys.rs`, drawn here — and the
// backend test `the_settings_ui_steppers_bounds_are_pinned_here` names this
// file and these constants, so a change to the enforced bounds fails there
// instead of drifting silently here (client-rule-mirroring golden path).

export const AUTOPILOT_PACING_KEY = 'fleet_autopilot.pacing';
export const AUTOPILOT_PACING_DEFAULT = true;

export const AUTOPILOT_PARALLEL_KEY = 'fleet_autopilot.max_parallel';
export const AUTOPILOT_PARALLEL_MIN = 1;
export const AUTOPILOT_PARALLEL_MAX = 10;
export const AUTOPILOT_PARALLEL_DEFAULT = 3;

export const AUTOPILOT_TARGET_KEY = 'fleet_autopilot.weekly_target_pct';
export const AUTOPILOT_TARGET_MIN = 10;
export const AUTOPILOT_TARGET_MAX = 100;
export const AUTOPILOT_TARGET_DEFAULT = 90;

export const AUTOPILOT_STOP_KEY = 'attention.usage_stop_pct';
export const AUTOPILOT_STOP_MIN = 50;
export const AUTOPILOT_STOP_MAX = 99.5;
export const AUTOPILOT_STOP_DEFAULT = 97;

export const AUTOPILOT_MARGIN_KEY = 'attention.fleet_start_margin_pct';
export const AUTOPILOT_MARGIN_MIN = 0;
export const AUTOPILOT_MARGIN_MAX = 40;
export const AUTOPILOT_MARGIN_DEFAULT = 10;

export const AUTOPILOT_MEMORY_STOP_KEY = 'fleet_autopilot.memory_stop_pct';
export const AUTOPILOT_MEMORY_STOP_MIN = 40;
export const AUTOPILOT_MEMORY_STOP_MAX = 95;
export const AUTOPILOT_MEMORY_STOP_DEFAULT = 75;

export const AUTOPILOT_MEMORY_PER_AGENT_KEY = 'fleet_autopilot.memory_per_agent_mb';
export const AUTOPILOT_MEMORY_PER_AGENT_MIN = 256;
export const AUTOPILOT_MEMORY_PER_AGENT_MAX = 8192;
export const AUTOPILOT_MEMORY_PER_AGENT_DEFAULT = 1500;

/** A bounded numeric setting, as one row of the Autopilot section. */
export interface AutopilotBound {
  key: string;
  min: number;
  max: number;
  defaultValue: number;
  step: number;
  /** Integers only (the backend parses `u32`); floats allowed otherwise. */
  integer: boolean;
}

export const AUTOPILOT_BOUNDS = {
  parallel: {
    key: AUTOPILOT_PARALLEL_KEY,
    min: AUTOPILOT_PARALLEL_MIN,
    max: AUTOPILOT_PARALLEL_MAX,
    defaultValue: AUTOPILOT_PARALLEL_DEFAULT,
    step: 1,
    integer: true,
  },
  target: {
    key: AUTOPILOT_TARGET_KEY,
    min: AUTOPILOT_TARGET_MIN,
    max: AUTOPILOT_TARGET_MAX,
    defaultValue: AUTOPILOT_TARGET_DEFAULT,
    step: 5,
    integer: true,
  },
  stop: {
    key: AUTOPILOT_STOP_KEY,
    min: AUTOPILOT_STOP_MIN,
    max: AUTOPILOT_STOP_MAX,
    defaultValue: AUTOPILOT_STOP_DEFAULT,
    step: 1,
    integer: false,
  },
  margin: {
    key: AUTOPILOT_MARGIN_KEY,
    min: AUTOPILOT_MARGIN_MIN,
    max: AUTOPILOT_MARGIN_MAX,
    defaultValue: AUTOPILOT_MARGIN_DEFAULT,
    step: 1,
    integer: false,
  },
  memoryStop: {
    key: AUTOPILOT_MEMORY_STOP_KEY,
    min: AUTOPILOT_MEMORY_STOP_MIN,
    max: AUTOPILOT_MEMORY_STOP_MAX,
    defaultValue: AUTOPILOT_MEMORY_STOP_DEFAULT,
    step: 5,
    integer: true,
  },
  memoryPerAgent: {
    key: AUTOPILOT_MEMORY_PER_AGENT_KEY,
    min: AUTOPILOT_MEMORY_PER_AGENT_MIN,
    max: AUTOPILOT_MEMORY_PER_AGENT_MAX,
    defaultValue: AUTOPILOT_MEMORY_PER_AGENT_DEFAULT,
    step: 128,
    integer: true,
  },
} as const satisfies Record<string, AutopilotBound>;

export type AutopilotBoundId = keyof typeof AUTOPILOT_BOUNDS;

/** The validator `useAppSetting` runs before it lets a value be saved. */
export function isWithin(bound: AutopilotBound, value: string): boolean {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (bound.integer && !Number.isInteger(n)) return false;
  return n >= bound.min && n <= bound.max;
}

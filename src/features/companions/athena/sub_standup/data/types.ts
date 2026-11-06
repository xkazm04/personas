import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import type { StandupItemPatch } from '@/lib/bindings/StandupItemPatch';
import type { ViewInput } from '../model/buildView';

export type BusyAction = 'open' | 'propose' | 'arm' | 'end';

/**
 * What the page reads from either source (live IPC or the DEV fixture). Each
 * region carries its own loading flag (loading pattern v2, law 6): the table,
 * the away log and the machine row settle independently.
 */
export interface StandupSource {
  kind: 'live' | 'fixture';
  input: ViewInput;
  /** The longer machine history for the Z zoom (12 days). */
  utilizationLong: readonly HostUtilizationPoint[];
  loading: { standup: boolean; events: boolean; machine: boolean };
  errors: { standup?: string; events?: string; machine?: string; action?: string };
  busy: Partial<Record<BusyAction, boolean>>;
  /** Proposals are streaming in after `standupPropose`. */
  proposing: boolean;
  actions: {
    open: () => Promise<void>;
    propose: () => Promise<void>;
    patch: (patch: StandupItemPatch) => Promise<void>;
    setRules: (rules: AwayRules) => Promise<void>;
    arm: () => Promise<void>;
    end: () => Promise<void>;
    /** Resolves to the conversation id, or null when it failed (the error is set inline). */
    discuss: (itemId: string) => Promise<string | null>;
    clearError: () => void;
  };
}

/**
 * console-style fan-out, partition A: harness entries for this partition's pages.
 * Owned by the partition-A builder; registry.tsx spreads it (wired by the Director).
 */
import type { HarnessModule } from './registry';

export const FANOUT_A_MODULES: Record<string, HarnessModule> = {};

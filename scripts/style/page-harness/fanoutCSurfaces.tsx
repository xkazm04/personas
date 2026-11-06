/**
 * console-style fan-out, partition C: harness entries for this partition's pages.
 * Owned by the partition-C builder; registry.tsx spreads it (wired by the Director).
 */
import type { HarnessModule } from './registry';

export const FANOUT_C_MODULES: Record<string, HarnessModule> = {};

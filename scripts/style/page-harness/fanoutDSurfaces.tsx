/**
 * console-style fan-out, partition D: harness entries for this partition's pages.
 * Owned by the partition-D builder; registry.tsx spreads it (wired by the Director).
 */
import type { HarnessModule } from './registry';

export const FANOUT_D_MODULES: Record<string, HarnessModule> = {};

/**
 * console-style fan-out, partition B: harness entries for this partition's pages.
 * Owned by the partition-B builder; registry.tsx spreads it (wired by the Director).
 */
import type { HarnessModule } from './registry';

export const FANOUT_B_MODULES: Record<string, HarnessModule> = {};

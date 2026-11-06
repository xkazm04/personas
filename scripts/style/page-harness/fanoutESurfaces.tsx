/**
 * console-style fan-out, partition E: harness entries for this partition's pages.
 * Owned by the partition-E builder; registry.tsx spreads it (wired by the Director).
 */
import type { HarnessModule } from './registry';

export const FANOUT_E_MODULES: Record<string, HarnessModule> = {};

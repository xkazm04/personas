/**
 * Fusion · which decision-surface style the stage renders (round 6 review).
 * `now` is the question block + answer cards Fusion shipped with; `v1`-`v3`
 * are the three redesigns built in the Personas design language. Not
 * persisted: a prototype switch, read once per review.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest and this switch.
 */

import { create } from 'zustand';

export type DecisionStyle = 'now' | 'v1' | 'v2' | 'v3';

export const DECISION_STYLES: { id: DecisionStyle; label: string; testId: string }[] = [
  { id: 'now', label: 'Now', testId: 'companion-fusion-decision-style-now' },
  { id: 'v1', label: 'V1', testId: 'companion-fusion-decision-style-v1' },
  { id: 'v2', label: 'V2', testId: 'companion-fusion-decision-style-v2' },
  { id: 'v3', label: 'V3', testId: 'companion-fusion-decision-style-v3' },
];

export const useDecisionStyle = create<{ style: DecisionStyle; set: (s: DecisionStyle) => void }>((set) => ({
  style: 'v1',
  set: (style) => set({ style }),
}));

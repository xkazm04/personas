/**
 * Filament — prototype copy (English). Moves to i18n only if this variant
 * wins the round (mirrors `../c/copy.ts`).
 *
 * TODO(prototype, 2026-10-03): consolidate the Athena chat switcher.
 */

export const FILAMENT_COPY = {
  tab: 'Filament',
  label: 'Filament line',
  waiting: (n: number) => (n === 1 ? '1 waiting' : `${n} waiting`),
  altW: 'Alt+W',
  altT: 'Alt+T',
  openLine: 'Open the line',
  nothingRunning: 'Nothing running',
  nothingWaiting: 'Nothing waiting',
  running: (n: number) => (n === 1 ? '1 running' : `${n} running`),
  tools: 'Tools',

  // Decision stage (same Oracle content contract as Halo · Spread).
  eyebrowDecision: 'Athena asks',
  eyebrowApproval: (action: string) => `Proposed action · ${action}`,
  eyebrowGuidance: (session: string) => `Session ${session} asks`,
  eyebrowMcpApproval: (session: string) => `Session ${session} wants to`,
  recommended: 'Athena recommends',
  askAthena: 'Ask Athena',
  setAside: 'Set aside',
  keySpace: 'Space',
  keyAsk: '0',
  athenaOwn: 'Athena',
  emptyTitle: 'Nothing on the line.',
  emptySub: 'When she needs a call, it lights here.',
  close: 'Back to the conversation',
  itemOf: (i: number, n: number) => `Item ${i} of ${n}`,
} as const;

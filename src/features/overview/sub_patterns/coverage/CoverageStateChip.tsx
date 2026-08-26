// One state chip for the Coverage lane — semantic tokens only, one palette
// (TONE_CHIP) shared with the ledger's pipeline pills so a state reads the
// same colour in the row and in the detail drawer.

import { TONE_CHIP, type ChipTone } from './variants/coverageDimensions';

export function CoverageStateChip({ tone, label }: { tone: ChipTone; label: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-interactive border px-1.5 py-0.5 typo-caption font-medium ${TONE_CHIP[tone]}`}>
      {label}
    </span>
  );
}

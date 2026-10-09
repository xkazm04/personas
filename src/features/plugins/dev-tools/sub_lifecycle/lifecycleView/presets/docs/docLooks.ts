// How a doc's status is DRAWN, everywhere the docs preset draws one: the
// module's pill (`system/Pill` with the look below), the kit's spine mark on a
// row, and the estate's cell. Every look is legible without colour:
// - pill: the stroke and the glyph (a broken doc is a closed solid stroke with
//   a crossed file; unverifiable is dashed and open: "could not be judged");
// - cell (`docsEstate.css`): broken is a square with a knocked-out cross,
//   stale a half-filled square, unverifiable a dashed hollow square, clean a
//   small round dot - so the rot stands out of a field of clean dots.
import { FileCheck, FileQuestion, FileWarning, FileX, type LucideIcon } from 'lucide-react';

import type { Glyph, Tone } from '@/features/shared/components/kit';

import type { PillLook } from '../../system/pillLooks';
import type { DocStatus } from '../docsModel';

export const DOC_LOOK: Record<DocStatus, PillLook> = {
  broken: { tone: 'error', stroke: 'solid', glyph: FileX },
  stale: { tone: 'warning', stroke: 'solid', glyph: FileWarning },
  unverifiable: { tone: 'info', stroke: 'dashed', glyph: FileQuestion },
  clean: { tone: 'success', stroke: 'hairline', glyph: FileCheck },
};

/** The spine mark per status (the kit's vocabulary, beside the module's pill). */
export const DOC_MARK: Record<DocStatus, { tone: Tone; glyph: Glyph }> = {
  broken: { tone: 'error', glyph: 'solid' },
  stale: { tone: 'warning', glyph: 'soft' },
  unverifiable: { tone: 'info', glyph: 'hollow' },
  clean: { tone: 'success', glyph: 'empty' },
};

/** A group head's glyph and ink. */
export const DOC_HEAD: Record<DocStatus, { glyph: LucideIcon; ink: string }> = {
  broken: { glyph: FileX, ink: 'text-status-error' },
  stale: { glyph: FileWarning, ink: 'text-status-warning' },
  unverifiable: { glyph: FileQuestion, ink: 'text-status-info' },
  clean: { glyph: FileCheck, ink: 'text-status-success' },
};

/**
 * The estate's cell edge in rem, by how many docs it draws: a small estate
 * gets cells you can aim at, a large one still fits a folder in a few rows.
 */
export function cellRem(total: number): number {
  if (total <= 80) return 1.125;
  if (total <= 240) return 0.875;
  return 0.6875;
}

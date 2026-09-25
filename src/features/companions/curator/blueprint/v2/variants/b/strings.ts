/**
 * i18n: every string this variant needs that `companions.blueprint.*` does not
 * already carry, gathered in ONE file.
 *
 * No keys are added in this round - three seats editing fourteen locale files
 * would collide - so these are plain English placeholders. They live here
 * rather than inline so the fusion pass has one file to extract from instead of
 * seven, and so a reviewer can see the whole vocabulary this variant invents
 * (it is thirteen strings; everything else comes from the shipped keys).
 *
 * Where a shipped key fits, it is used instead and this file stays out of the
 * way: the four ink names, the nine channel names, every queue state word, the
 * scan stamp, the empty-plan copy and the lane's own copy are all shipped keys.
 */
export const EN = {
  /** The measured ink's own name, beside `legend_*` for the other three. */
  aCount: 'a count',
  /** The unknown ink's MEANING, so the legend does not say "unknown" twice. */
  nobodyLooked: 'nobody looked',
  /** The short forms the inks say inline; the long sentences are shipped keys. */
  none: 'none',
  noBasis: 'no basis',
  /** The pre-processing pass has not read this intake yet. */
  notReadYet: 'not read yet',
  /** The pass ran, fetched the resource, and found nothing to name. */
  nothingToName: 'nothing to name',
  /** Ties the sheet's first line back to the row it came from. */
  onTheRow: 'on the row',
  /** The lane filter that isolates the unread intakes. */
  notReadFilter: 'not read yet',
  /** The lane's unfiltered segment. */
  allLane: 'all',
  /** The prototype-only data-source switch. */
  sourceLoaded: 'measured',
  sourceNow: 'nothing yet',
  sourceRefused: 'doors refused',
} as const;

/** `{n} of the nine score here` - the sheet's claim about its own row. */
export function scoreOfNine(n: number): string {
  return `${String(n)} of the nine score here`;
}

/** `<reason> carries {n} of {total} points` - why one measure is enough. */
export function carries(reason: string, n: number, total: number): string {
  return `${reason} carries ${String(n)} of ${String(total)} points`;
}

/** `{n} read` - how much of the sitting the pre-pass has named. */
export function readCount(n: number): string {
  return `${String(n)} read`;
}

/** The enrichment gauge's accessible sentence. */
export function gaugeSay(read: number, unread: number, barren: number): string {
  return `${String(read)} read, ${String(unread)} not read, ${String(barren)} with nothing to name`;
}

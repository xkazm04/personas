/**
 * The confidence floor below which a passage is flagged as "partial text".
 *
 * The ingest pipeline stamps `extraction_confidence` on every chunk and every
 * extracted entity; a value under this threshold means the text was read off a
 * mostly-image page and is probably incomplete.
 *
 * This lived as two independent `const PARTIAL_CONFIDENCE = 0.99` declarations —
 * one in `search/SearchResultCard.tsx`, one in `extract/EntityTable.tsx` — with
 * nothing comparing them. Two surfaces reading the same backend field have to
 * agree on where the line is, so the number is declared once, here.
 */
export const PARTIAL_CONFIDENCE = 0.99;

/** True when this chunk/entity came from a page the extractor could only partly read. */
export function isPartialExtraction(confidence: number): boolean {
  return confidence < PARTIAL_CONFIDENCE;
}

/**
 * Which body sections of a prose card fold, and the count + preview each
 * folded line shows. React-free so the thresholds are testable on fixtures.
 *
 * The thresholds are the deck's reading budget at 1280x800: the head (eyebrow,
 * a two-line ask, the context line, the outcome pair) leaves roughly fourteen
 * body lines above the card's foot, and the case itself must keep most of them.
 */
import type { DecisionItem } from '../model/decisionModel';

export interface FoldLine { count: number; preview: string }

export interface FoldPlan {
  /** Folded only on a question card, whose answer fields must stay in view. */
  body: FoldLine | null;
  reasoning: FoldLine | null;
  evidence: FoldLine | null;
}

/** Evidence longer than this many lines folds. */
export const EVIDENCE_FOLD_LINES = 6;
/** A why-raised longer than this many characters folds. */
export const REASONING_FOLD_CHARS = 280;
/** A question card's case longer than this many characters folds. */
export const QUESTION_BODY_FOLD_CHARS = 360;

const PREVIEW_CHARS = 120;

/** The first line with a word in it (not a rule, not a lone `{`), markdown's leading marks stripped. */
export function previewOf(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => /[\p{L}\p{N}]/u.test(l)) ?? '';
  const plain = line.replace(/^(#{1,6}\s+|[-*+]\s+|>\s*|\d+\.\s+)/, '').replace(/[*_`]/g, '');
  return plain.length > PREVIEW_CHARS ? plain.slice(0, PREVIEW_CHARS).trimEnd() + '…' : plain;
}

function paragraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((p) => p.trim()).length;
}

export function foldPlan(item: DecisionItem): FoldPlan {
  const reasoning = item.reasoning?.trim() ?? '';
  const evidence = item.evidence ?? '';
  const evidenceLines = evidence ? evidence.split('\n').length : 0;
  return {
    body: item.input && item.body.length > QUESTION_BODY_FOLD_CHARS
      ? { count: paragraphs(item.body), preview: previewOf(item.body) }
      : null,
    reasoning: reasoning.length > REASONING_FOLD_CHARS
      ? { count: paragraphs(reasoning), preview: previewOf(reasoning) }
      : null,
    evidence: evidenceLines > EVIDENCE_FOLD_LINES
      ? { count: evidenceLines, preview: previewOf(evidence) }
      : null,
  };
}

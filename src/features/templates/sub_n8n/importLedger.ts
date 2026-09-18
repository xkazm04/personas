/**
 * What the import KEPT, reconciled against what the source document contained.
 *
 * The analyze step counted only survivors — `selectedToolIndices.size` and its
 * two siblings — so a workflow node the parser could not map simply never
 * appeared, and an importer discovered the missing Slack step only after the
 * persona was built. The detector already walks the raw document and reports
 * how many elements it found (`countElements`), and the upload step already
 * calls it, so the source side of the reconciliation costs nothing new.
 *
 * WHAT THE NUMBERS MEAN, precisely, because a loss ledger that overstates is
 * worse than none:
 *
 * - `detected` is the element count the DETECTOR found in the raw document.
 * - `represented` is what the PARSE produced. `workflowPipeline` maps each
 *   action node to exactly one tool and each trigger node to one trigger, so
 *   tools + triggers is the node count that survived the mapping.
 * - `unrepresented` is the difference, FLOORED AT ZERO. The floor is not
 *   cosmetic: an adapter may contribute `fallbackTriggers` that correspond to
 *   no node at all, so `represented` can legitimately exceed `detected` and a
 *   negative "dropped" would be a fabrication.
 * - `deselected` is what the user themselves unticked — a different kind of
 *   loss from an unsupported node type, so it is reported separately rather
 *   than folded into one number.
 *
 * Deliberately NOT reported: which specific nodes were dropped. They are
 * discarded inside the parser before this layer sees anything, and inventing a
 * list would be exactly the dishonesty the ledger exists to correct.
 */
import { countElements, type ElementNoun } from '@/lib/personas/parsers/workflowDetector';
import type { AgentIR } from '@/lib/types/designTypes';

export interface ImportLedger {
  /** Elements the detector found in the source document. */
  detected: number;
  noun: ElementNoun;
  /** Tools + triggers the parse produced. */
  represented: number;
  /** Detected elements the parse produced nothing for. */
  unrepresented: number;
  /** Tools + triggers currently ticked for import. */
  selected: number;
  /** Parsed items the user unticked. */
  deselected: number;
}

/**
 * Reconcile a parse against its source. Returns `null` when the raw document
 * cannot be re-read — an unknown detected count must render nothing, never a
 * zero that reads as "the file was empty".
 */
export function computeImportLedger(
  rawWorkflowJson: string,
  result: AgentIR,
  selectedToolIndices?: Set<number>,
  selectedTriggerIndices?: Set<number>,
): ImportLedger | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawWorkflowJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const { count: detected, label: noun } = countElements(parsed as Record<string, unknown>);
  if (detected <= 0) return null;

  const tools = result.suggested_tools?.length ?? 0;
  const triggers = result.suggested_triggers?.length ?? 0;
  const represented = tools + triggers;

  const selected = selectedToolIndices || selectedTriggerIndices
    ? (selectedToolIndices?.size ?? tools) + (selectedTriggerIndices?.size ?? triggers)
    : represented;

  return {
    detected,
    noun,
    represented,
    unrepresented: Math.max(0, detected - represented),
    selected,
    deselected: Math.max(0, represented - selected),
  };
}

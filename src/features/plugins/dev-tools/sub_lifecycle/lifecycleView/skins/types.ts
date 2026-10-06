/**
 * The variant axis for this surface is VISUAL EXECUTION, not arrangement.
 *
 * The owner's verdict on the previous round (2026-10-06): "Keep Rail below
 * variant and redo the prototype round, the goal was to upgrade component
 * visual design and visual quality, not to keep components and experiment with
 * the layout." So there is exactly ONE arrangement - `variants/RailBelow` -
 * and a skin is the variant: same regions, same information, same reading
 * order, same interaction, different design.
 *
 * Every field here is a decision a designer would argue about, and no field
 * can move a region or hide information. That is the contract: a skin cannot
 * express a layout, so a layout cannot sneak back in as a skin.
 *
 * It also holds no human-readable TEXT. The switcher's display name lives with
 * the switcher (`LifecyclePage`), not here: an object that pairs an English
 * `label` with colour utilities is the `untranslatable-token-label` condition -
 * the name of a vocabulary member authored at the same site as its
 * presentation, where nothing can ever translate it. A visual spec has no
 * business owning a string anyway.
 */
import type { NodeMark } from '../../journey/journeyStyles';

export type SkinId = 'wash' | 'engraved' | 'plated';

export interface LifecycleSkin {
  id: SkinId;

  // -- page rhythm ----------------------------------------------------------
  /** Vertical gap of the page column. */
  pageGap: string;
  /** How the state region is separated from the rail above it. */
  regionWrap: string;

  // -- the weakest-step headline -------------------------------------------
  headlineWrap: string;
  headlineType: string;
  /** true: the sentence is inked with the weakest step's status colour. */
  headlineStatusInk: boolean;

  // -- the rail ------------------------------------------------------------
  railWrap: string;
  /** Per-lane container: this is where lane structure is made visible. */
  laneWrap: string;
  /** The "Before / After the task" head. Always an eyebrow; the ink varies. */
  laneHead: string;
  /** The connector stroke behind one lane's node row. */
  connector: string;
  /** Which fill treatment the node mark uses. */
  nodeMark: NodeMark;
  /** The opaque plate behind a node, so the connector never crosses the glyph. */
  nodeBacking: string;
  /** How a selected node is marked, on top of its state shape. */
  nodeSelected: string;
  /** The node's caption. Both states are ONE type step; weight and ink differ. */
  nodeLabel: string;
  nodeLabelOn: string;
  /** The evidence dot. */
  dot: string;

  // -- the legend ----------------------------------------------------------
  legendWrap: string;
  legendItem: string;
  /** Size + fill of the state chip; the ladder itself is shared. */
  legendChip: string;
  /** The one-sentence footnote. A tier BELOW the state names, never equal. */
  legendNote: string;

  // -- the selected step's state panel -------------------------------------
  panelWrap: string;
  panelHead: string;
  /** The step glyph's frame in the panel head. */
  panelGlyph: string;
  panelTitle: string;
  panelMeta: string;
  panelTally: string;
  /** The two-column body under the head. The COLUMNS are fixed by the
   *  arrangement; a skin may only change its padding and its gaps. */
  panelBody: string;
  /** Section heads inside the panel (Rule, Bindings). */
  sectionHead: string;
  ruleText: string;
  bindingList: string;
  bindingRow: string;
  bindingKind: string;
  bindingChip: string;

  // -- the evidence ledger -------------------------------------------------
  ledgerDensity: 'comfortable' | 'compact';
  ledgerRowHeight: number;
  ledgerBorderless: boolean;
  /** true: a failed / skipped row gets a status rail on its leading edge. */
  ledgerAccent: boolean;
  /** Reserved heights for the state region, so the panel never shoves the rail. */
  regionMinHeight: string;
  ledgerHeight: string;
}

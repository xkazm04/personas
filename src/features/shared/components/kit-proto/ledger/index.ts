/**
 * Ledger composition kit (Gate K decision prototype, spark style-unification).
 * Ported from the style-kit contest entry A/1 "Ledger": only the compositions
 * Fleet Activity uses. Deleted, or promoted, when the owner decides between this
 * kit and A/3 "Spine & Lens". Render every composition inside `<LedgerKit>`, the
 * scope its stylesheet is written against.
 */
import './kit.css';

export { LedgerKit } from './LedgerKit';
export { ledgerCols, type LedgerSpec, type LedgerTone } from './grid';
export { Section } from './Section';
export { LedgerBlock, ColHead, LedgerRow, RowPrimary, type ColumnHead } from './LedgerBlock';
export { Figure, Units, SplitBar, ledgerCompact, type LedgerUnit, type SplitPart } from './Figure';
export { StatStrip, StatTile } from './StatStrip';
export { KeyValueGrid, ChipRow, type KeyValueItem, type ChipItem } from './KeyValueGrid';
export { Toolbar, Segmented, SearchField, type SegmentOption } from './Toolbar';
export { Folio, FolioPart, LedgerSplit } from './Folio';
export { EmptyRow, GhostRows } from './EmptyRow';

/**
 * Spine & Lens (A/3), the composition kit shortlisted in the style-kit contest, ported for the
 * Gate K decision (spark style-unification, 2026-09-25). Dev-only prototype: rendered by
 * Fleet Activity's kit switch (`plugins/fleet/sub_activity/prototype/`) and deleted, or promoted,
 * when the owner decides. API: the contest entry's API.md, reduced to what Fleet Activity uses.
 */
import './kit.css';

export { KitHost, Surface, Split, Drawer } from './Surface';
export { Section, Meta, type SectionProps } from './Section';
export { ListRow, Rows, type ListRowProps, type RowSize } from './ListRow';
export { StatStrip, type StatTile } from './StatStrip';
export { KeyValueGrid, type KeyValueItem } from './KeyValueGrid';
export { ChipRow, ChipView, type Chip } from './ChipRow';
export { Toolbar, Segmented, SearchField, KitButton, type SegmentOption } from './Toolbar';
export { DataTable, type TableCol, type TableRow } from './DataTable';
export { UnitStrip, apportion, type UnitSegment, type UnitSize } from './UnitStrip';
export { Mark, Dot } from './Mark';
export { Ghost, GhostRows, type EmptySpec } from './states';
export type { Tone, Glyph, KitState, KitStates } from './types';

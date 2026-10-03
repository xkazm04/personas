/**
 * The composition kit: the shared building blocks one level above buttons (section, list row,
 * data table, stat strip, key-value grid, chip row, toolbar, unit strip, status mark, trail,
 * context card, hint) plus the surface primitives they hang from (KitHost, Surface, Split,
 * Drawer). Spine & Lens, chosen by the owner at Gate K (spark style-unification, 2026-09-25).
 * A surface is composed from these; when and how: docs/design/style-mastery/doctrine.md,
 * "Composition kit".
 */
import './kit.css';

export { KitHost, Surface, Split, Drawer } from './Surface';
export { Section, Meta, type SectionProps } from './Section';
export { ListRow, Rows, type ListRowProps, type RowSize } from './ListRow';
export { Tiles, Tile, type TileProps } from './Tiles';
export { Stack, type StackGap } from './Stack';
export { StatStrip, type StatTile } from './StatStrip';
export { KeyValueGrid, type KeyValueItem } from './KeyValueGrid';
export { ChipRow, ChipView, type Chip } from './ChipRow';
export { Toolbar, Segmented, SearchField, KitButton, type SegmentOption, type KitButtonTone } from './Toolbar';
export { Crumbs, type Crumb } from './Crumbs';
export { RangePicker, type RangePreset } from './RangePicker';
export { DataTable, type TableCol, type TableRow } from './DataTable';
export { sortRows, nextSort, type TableSort, type SortDir, type SortValue } from './sortRows';
export { UnitStrip, apportion, type UnitSegment, type UnitSize } from './UnitStrip';
export { quantumFor } from './quantum';
export { Mark, Dot } from './Mark';
export { ChartFrame, toneColor } from './ChartFrame';
export { ContextCard, ContextCards, type ContextCardProps } from './ContextCard';
export { ContextGroups, type ContextGroupRow, type ContextGroupState } from './ContextGroups';
export { ContextOverview, contextLevel, CARD_LEVEL_MAX, MATCH_CAP, type ContextGroup } from './ContextOverview';
export { Hint } from './Hint';
export { Ghost, GhostRows, type EmptySpec } from './states';
export type { Tone, Glyph, KitState, KitStates } from './types';

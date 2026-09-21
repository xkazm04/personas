// Presentational pieces for the Skills Registry heatmap — column heads, skill
// labels, cells, the column-filter banner. The orchestrator lives in
// RegistryHeatmap.tsx so this file stays a leaf.
import { ArrowDownToLine, Play, X } from 'lucide-react';
import { motion } from 'framer-motion';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { MOTION } from '@/lib/utils/designTokens';

import { type CellStatus, type RegistryColumn, type RegistrySkill } from '../../registryTypes';

/** hex (#RRGGBB) → rgba with the given alpha. */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const COL = '2.5rem';
export const NEUTRAL = 'var(--status-neutral)';
const VERTICAL: React.CSSProperties = { writingMode: 'vertical-rl', transform: 'rotate(180deg)' };

/** Content-sized skill column: grows with the longest name, capped so a
 *  pathological label cannot shove the cell field off-screen. */
export function skillTrack(names: string[]): string {
  const longest = names.reduce((m, n) => Math.max(m, n.length), 8);
  const ch = Math.min(40, Math.max(16, longest + 10));
  return `minmax(13rem, min(${ch}ch, 24rem))`;
}

export const ROW_VARIANTS = {
  hidden: { opacity: 0, y: -8 },
  shown: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export function ColHead({
  column, selected, hint, filterAria, onToggle, layoutId,
}: {
  column: RegistryColumn;
  selected: boolean;
  hint: string;
  filterAria: string;
  onToggle: () => void;
  layoutId: string | undefined;
}) {
  return (
    <Tooltip content={hint} placement="top">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={filterAria}
        onClick={onToggle}
        data-testid={`registry-col-${column.id}`}
        className={`relative h-24 w-full flex flex-col items-center justify-end gap-1.5 pb-2 min-w-0 rounded-t-interactive focus-ring ${
          selected ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-primary/5'
        }`}
      >
        <span
          className="typo-caption leading-none whitespace-nowrap overflow-hidden max-h-[5rem]"
          style={VERTICAL}
        >
          {column.name}
        </span>
        <span
          className={`rounded-full flex-shrink-0 ${selected ? 'w-2 h-2' : 'w-1.5 h-1.5'}`}
          style={{ backgroundColor: column.color ?? NEUTRAL }}
        />
        {selected && (
          <motion.span
            layoutId={layoutId}
            className="absolute inset-x-1 bottom-0 h-0.5 rounded-pill bg-primary"
          />
        )}
      </button>
    </Tooltip>
  );
}

export function SkillName({
  skill, onOpenInfo,
}: {
  skill: RegistrySkill;
  onOpenInfo?: (skill: string) => void;
}) {
  const label = onOpenInfo ? (
    <button
      type="button"
      onClick={() => onOpenInfo(skill.name)}
      className="typo-caption text-foreground text-left hover:text-primary transition-colors rounded-interactive focus-ring min-w-0 truncate"
      data-testid={`registry-skill-${skill.name}`}
    >
      {skill.name}
    </button>
  ) : (
    <span
      className="typo-caption text-foreground min-w-0 truncate"
      data-testid={`registry-skill-${skill.name}`}
    >
      {skill.name}
    </span>
  );

  if (!skill.description) return label;

  return (
    <Tooltip
      content={skill.description}
      delay={MOTION.delay.tooltip.fast}
      triggerFocusable={!onOpenInfo}
      triggerClassName="min-w-0 truncate"
    >
      {label}
    </Tooltip>
  );
}

export function FilterBar({
  caption, clearLabel, clearAria, onClear,
}: {
  caption: string;
  clearLabel: string;
  clearAria: string;
  onClear: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/10 bg-primary/5"
      data-testid="registry-filter-banner"
    >
      <span className="typo-caption text-foreground min-w-0 truncate">{caption}</span>
      <Button
        variant="ghost"
        size="xs"
        onClick={onClear}
        aria-label={clearAria}
        data-testid="registry-filter-clear"
        icon={<X className="w-3 h-3" aria-hidden />}
      >
        {clearLabel}
      </Button>
    </div>
  );
}

export function HeatCell({
  skillName, columnId, status, pct, hue, running,
  projectMode, selected, coverageHint, useLabel, adoptLabel, runningLabel,
  onUse, onAdopt,
}: {
  skillName: string;
  columnId: string;
  status: CellStatus;
  pct: number;
  hue: string;
  running: boolean;
  projectMode: boolean;
  selected: boolean;
  coverageHint: string;
  useLabel: string;
  adoptLabel: string;
  runningLabel: string;
  onUse: () => void;
  onAdopt: () => void;
}) {
  const selectedRing = selected ? 'ring-1 ring-primary/40' : '';
  const testId = `registry-cell-${skillName}-${columnId}`;

  if (status === 'adopted') {
    return (
      <Tooltip content={coverageHint} delay={MOTION.delay.tooltip.fast}>
        <AdoptedCell
          pct={pct}
          hue={hue}
          running={running}
          selectedRing={selectedRing}
          useLabel={useLabel}
          testId={testId}
          onUse={onUse}
        />
      </Tooltip>
    );
  }

  if (projectMode) {
    return (
      <button
        type="button"
        onClick={onUse}
        disabled={running}
        aria-label={useLabel}
        className={`h-8 mx-0.5 my-0.5 rounded-interactive border border-dashed border-border flex items-center justify-center text-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/[0.06] transition-colors disabled:cursor-not-allowed focus-ring ${running ? 'animate-pulse' : ''} ${selectedRing}`}
        data-testid={testId}
      >
        <Play className="w-3.5 h-3.5" aria-hidden />
      </button>
    );
  }

  const busy = status === 'adopting';
  const blocked = status === 'blocked';
  return (
    <button
      type="button"
      disabled={busy || blocked}
      onClick={onAdopt}
      aria-label={blocked ? runningLabel : adoptLabel}
      className={`h-8 mx-0.5 my-0.5 rounded-interactive border border-dashed border-border flex items-center justify-center text-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/[0.06] transition-colors disabled:cursor-not-allowed focus-ring ${busy ? 'animate-pulse border-solid border-primary/40 text-primary' : ''} ${blocked ? 'opacity-40' : ''} ${selectedRing}`}
      data-testid={testId}
    >
      <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden />
    </button>
  );
}

function AdoptedCell({
  pct, hue, running, selectedRing, useLabel, testId, onUse,
}: {
  pct: number;
  hue: string;
  running: boolean;
  selectedRing: string;
  useLabel: string;
  testId: string;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onUse}
      aria-label={useLabel}
      className={`group relative h-8 mx-0.5 my-0.5 rounded-interactive flex items-center justify-center transition-colors hover:brightness-110 focus-ring ${running ? 'ring-2 ring-status-info/60' : ''} ${selectedRing}`}
      style={{ backgroundColor: withAlpha(hue, 0.18 + (pct / 100) * 0.55) }}
      data-testid={testId}
    >
      <Play className="w-3.5 h-3.5 text-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
    </button>
  );
}

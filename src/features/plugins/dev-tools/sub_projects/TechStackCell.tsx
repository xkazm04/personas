// The Manage table's stack cell: official brand glyphs where the label names a
// known stack, a text chip where it does not.
//
// MEASURED ON THE REAL DATABASE before this was written (101 projects, a backup
// copy, read-only), because the shape of this column is not what its name
// suggests:
//
//   - 126 stack tokens across 101 projects, of which 46 (36%) resolve to an
//     official icon. Those are the ones worth drawing.
//   - 58 of the unresolved tokens are PROSE - four words or more. `tech_stack`
//     is where several projects keep a description: "Writing - Health blog
//     content", "AI consulting - Multi-agent feasibility study", "Blockchain
//     frontend - Stellar asset metadata". They are not stacks and no map can
//     make them into stacks.
//   - Case and version variance is everywhere: `Rust` and `rust`, `React` and
//     `react`, `next 16`, `React 19`, `Next.js 16`.
//
// WHY THERE IS NO DATABASE BACKFILL, though one was asked for. The resolver
// already absorbs the variance at RENDER time - `resolveTechIcon` lowercases,
// tokenises and alias-matches, so `Rust`, `rust` and `rust 1.84` all land on one
// glyph with "1.84" kept beside it. A migration that rewrote the column to
// canonical tokens would buy nothing on those 46, and on the 58 prose values it
// would either mangle them or delete the only copy of that text. Rendering is
// reversible and a migration is not; a new spelling keeps working here without
// another migration. If the real goal is to stop descriptions landing in a stack
// field, that is a WRITE-path fix where the value is authored, not a sweep over
// what is already stored.
//
// One parse fix did land: the value is split on `/` and `;` as well as `,`, so
// `Next.js/TypeScript/Tailwind` is three glyphs instead of one unmatched chip.
// Measured gain on the real rows: 43 resolved to 46.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { resolveTechIcon, TechGlyph } from '@/features/shared/components/display/techIcons';

/** A prose value is not a chip. Cap it so one description cannot set the
 *  column's width for every other row. */
const PROSE_CHARS = 28;

/**
 * Projects store `tech_stack` as one string. `toProject` splits it on commas,
 * but real rows also use `/` and `;` - so split again here rather than changing
 * the shared view-model, which other surfaces read.
 */
export function splitStackTokens(tokens: readonly string[]): string[] {
  return tokens
    .flatMap((t) => t.split(/[/;]/))
    .map((t) => t.trim())
    .filter(Boolean);
}

export function TechStackCell({ tokens }: { tokens: readonly string[] }) {
  const parts = splitStackTokens(tokens);
  if (parts.length === 0) return null;
  return (
    <span className="flex items-center gap-1 min-w-0">
      {parts.map((label, i) => {
        const match = resolveTechIcon(label);
        if (match) {
          return (
            // The glyph IS the label. Its name lives in the tooltip, and any
            // residual detail ("19", "16.2") rides beside it, because a version
            // is the one part of the string the icon cannot say.
            <Tooltip key={`${label}-${i}`} content={label}>
              <span className="inline-flex items-center gap-1 shrink-0 cursor-default">
                <TechGlyph icon={match.icon} />
                {match.residual && (
                  <span className="typo-caption text-foreground tabular-nums">{match.residual}</span>
                )}
              </span>
            </Tooltip>
          );
        }
        const long = label.length > PROSE_CHARS;
        return (
          <Tooltip key={`${label}-${i}`} content={label}>
            <span className="inline-flex items-center rounded-input bg-secondary/40 border border-primary/10 px-1.5 py-0.5 typo-caption text-foreground min-w-0 max-w-[12rem] truncate cursor-default">
              {long ? `${label.slice(0, PROSE_CHARS).trimEnd()}…` : label}
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}

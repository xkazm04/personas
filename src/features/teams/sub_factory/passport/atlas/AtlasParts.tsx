// Passport Atlas — the small parts every layer shares: the state mark (a kit
// Dot plus the atlas's non-colour cue per state), the ladder of rungs, and the
// rendering of one normalized cell value.
import { ChipRow, Dot, KeyValueGrid } from '@/features/shared/components/kit';
import type { CellValue } from '../passportRows';
import { ENV_LABEL, AUTOMATION_LABEL, PROD_BAND_LABEL, AUTOMATION_SCALE, PROD_BAND_SCALE } from '../passportModel';
import type { AtlasInk } from './atlasModel';
import { ATLAS_WORDS as W, INK_MARK } from './atlasWords';

/** A state as a mark. `data-ink` carries the shape cue (half-fill, square, dashed ring),
 *  so a greyscale reading still tells the six states apart. */
export function InkDot({ ink, label }: { ink: AtlasInk; label?: boolean }) {
  const m = INK_MARK[ink];
  return (
    <span className="atlas-ink" data-ink={ink} role="img" aria-label={m.label}>
      <Dot tone={m.tone} glyph={m.glyph} />
      {label && <span aria-hidden="true">{m.label}</span>}
    </span>
  );
}

export function valueText(v: CellValue): string {
  switch (v.kind) {
    case 'level': return `${v.level} · ${AUTOMATION_LABEL[v.level]} · ${v.score}/100`;
    case 'band': return `${PROD_BAND_LABEL[v.band]} · ${v.score}/100`;
    case 'ordinal': return v.label;
    case 'present': return v.label ?? W.notConfigured;
    case 'chips': return v.items.join(' · ') || W.notConfigured;
    case 'pips': return v.items.filter((i) => i.on).map((i) => i.label).join(' · ') || W.notConfigured;
    case 'bool': return v.on ? 'Enabled' : 'Not enabled';
    case 'counts': return v.items.map((i) => `${i.count} ${i.label}`).join(' · ');
    case 'env': return v.slots.map((s) => `${ENV_LABEL[s.env]}: ${s.label ?? W.notConfigured}`).join(' · ');
    case 'cost': return v.state === 'known' ? `${v.currency ?? ''} ${v.total ?? 0} / month`.trim() : v.state === 'missing' ? 'No app-cost.json' : 'No services recorded';
  }
}

/** Ordinal rungs with the current one lit; an unverified value keeps its rung but loses the fill. */
export function Ladder({ steps, reached, unverified }: { steps: string[]; reached: number; unverified?: boolean }) {
  return (
    <ol className={`atlas-ladder${unverified ? ' is-unverified' : ''}`} aria-label={W.rung(reached + 1, steps.length)}>
      {steps.map((s, i) => (
        <li key={s} className={i === reached ? 'is-current' : i < reached ? 'is-passed' : undefined} aria-current={i === reached ? 'step' : undefined}>
          <span className="atlas-ladder__line" aria-hidden="true" />
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** The ladder a value sits on, when it has one (ordinal rows and the two headline scores). */
export function ladderOf(v: CellValue, scaleLabels?: string[]): { steps: string[]; reached: number } | null {
  if (v.kind === 'level') return { steps: AUTOMATION_SCALE.map((l) => AUTOMATION_LABEL[l]), reached: AUTOMATION_SCALE.indexOf(v.level) };
  if (v.kind === 'band') return { steps: PROD_BAND_SCALE.map((b) => PROD_BAND_LABEL[b]), reached: PROD_BAND_SCALE.indexOf(v.band) };
  if (v.kind === 'ordinal' && scaleLabels && v.reached != null) return { steps: scaleLabels, reached: v.reached };
  return null;
}

/** One value in full: chips as chips, environments as a key-value grid, capabilities as marks. */
export function ValueView({ v, unknown }: { v: CellValue; unknown?: boolean }) {
  if (v.kind === 'chips' && v.items.length > 0) {
    return <ChipRow chips={v.items.map((x) => ({ id: x, label: x }))} label={v.items.join(', ')} emptyLabel={W.notConfigured} />;
  }
  if (v.kind === 'counts') {
    return <ChipRow chips={v.items.map((x) => ({ id: x.label, label: x.label, count: x.count, tone: x.warn && x.count > 0 ? 'warning' as const : undefined, glyph: x.warn && x.count > 0 ? 'soft' as const : undefined }))} label={valueText(v)} emptyLabel={W.notConfigured} />;
  }
  if (v.kind === 'env') {
    return <KeyValueGrid items={v.slots.map((s) => ({ k: ENV_LABEL[s.env], v: s.label ? (s.sub ? `${s.label} · ${s.sub}` : s.label) : null, none: W.notConfigured }))} />;
  }
  if (v.kind === 'pips') {
    return (
      <span className="atlas-pips">
        {v.items.map((i) => (
          <span key={i.label} className="atlas-pip"><InkDot ink={unknown ? 'unknown' : i.on ? 'good' : 'bad'} />{i.label}</span>
        ))}
      </span>
    );
  }
  return <span className="atlas-value typo-body-lg">{valueText(v)}</span>;
}

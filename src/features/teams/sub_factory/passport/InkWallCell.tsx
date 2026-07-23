// Cell renderer in Focus ink — segmented level bars for ordinals, brand icons
// with visible names for stack/tooling, blue "set up →" for meaningful gaps.
// Pips/bool keep the production widgets (their labels already read well).
// Exported (via ProjectsPassportWall) for reuse in the Mastermind sidebar.
import { formatCost } from '@/lib/utils/formatters';
import type { CellValue } from './passportRows';
import { AUTOMATION_LABEL, PROD_BAND_LABEL, ENV_LABEL, APP_COST_FILENAME } from './passportModel';
import { INK, SegBar, TechInk, scoreInk } from './passportInk';
import { Pips, BoolMark } from './passportWidgets';
import { COPY, MAX_CHIPS } from './wallConfig';

export function InkWallCell({ value }: { value: CellValue }) {
  switch (value.kind) {
    case 'level':
    case 'band': {
      // Headline rows are filtered out of the body (covers carry the axes) —
      // render a compact ink line if one ever appears.
      const label = value.kind === 'level' ? `${value.level} · ${AUTOMATION_LABEL[value.level]}` : PROD_BAND_LABEL[value.band];
      const hue = scoreInk(value.score);
      return <span className="typo-caption font-semibold" style={{ color: hue }}>{label} · {value.score}</span>;
    }
    case 'ordinal': {
      const hue = value.pos >= 0.65 ? INK.emerald : value.pos >= 0.35 ? INK.amber : INK.red;
      const steps = value.steps ?? 0;
      const reached = value.reached ?? 0;
      return (
        <span className="block min-w-0 max-w-[210px]">
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span className="typo-caption font-medium truncate" style={{ color: hue }}>{value.label}</span>
            {value.sub && <span className="text-[11px] text-foreground/45 truncate">{value.sub}</span>}
            {steps > 0 && <span className="text-[11px] tabular-nums text-foreground/40 shrink-0 ml-auto">{reached}/{steps}</span>}
          </span>
          {steps > 0 && (
            <span className="block mt-1.5">
              <SegBar steps={steps} reached={reached} hue={hue} />
            </span>
          )}
        </span>
      );
    }
    case 'present':
      return value.label ? (
        <span className="inline-flex flex-col gap-0.5 min-w-0">
          <TechInk label={value.label} />
          {value.sub && <span className="typo-label text-foreground/45 truncate">{value.sub}</span>}
        </span>
      ) : (
        <span className="typo-caption font-medium" style={{ color: INK.blue }}>{COPY.setUp}</span>
      );
    case 'chips': {
      if (value.items.length === 0) return <span className="typo-caption font-medium" style={{ color: INK.blue }}>{COPY.add}</span>;
      return (
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          {value.items.slice(0, MAX_CHIPS).map((c) => <TechInk key={c} label={c} muted />)}
          {value.items.length > MAX_CHIPS && <span className="typo-caption text-foreground/45">+{value.items.length - MAX_CHIPS}</span>}
        </span>
      );
    }
    case 'pips':
      return <Pips items={value.items} />;
    case 'bool':
      return <BoolMark on={value.on} />;
    case 'counts': {
      const total = value.items.reduce((a, i) => a + i.count, 0);
      if (total === 0) return <span className="typo-caption font-medium" style={{ color: INK.blue }}>{COPY.add}</span>;
      return (
        <span className="inline-flex items-center gap-x-2.5 min-w-0">
          {value.items.map((i) => (
            <span key={i.label} className="inline-flex items-baseline gap-1">
              <span
                className={`typo-caption font-semibold tabular-nums ${i.warn && i.count > 0 ? '' : i.count > 0 ? 'text-foreground/90' : 'text-foreground/35'}`}
                style={i.warn && i.count > 0 ? { color: INK.amber } : undefined}
              >
                {i.count}
              </span>
              <span className="typo-label text-foreground/45" style={i.warn && i.count > 0 ? { color: `${INK.amber}B3` } : undefined}>{i.label}</span>
            </span>
          ))}
        </span>
      );
    }
    case 'env': {
      // Three visually separated slots (local / test / prod). A known source
      // renders in TechInk (brand glyph when resolvable); an unknown one is an
      // explicit em-dash empty state — the honest "nothing in the codebase".
      return (
        <span className="flex min-w-0 max-w-[220px]" data-testid="env-split-cell">
          {value.slots.map((s, i) => (
            <span key={s.env} className={`flex flex-col gap-1 min-w-0 flex-1 ${i > 0 ? 'pl-2 ml-2 border-l border-foreground/10' : ''}`}>
              <span className={`text-[8.5px] uppercase tracking-[0.14em] leading-none ${s.label ? 'text-foreground/45' : 'text-foreground/25'}`}>{ENV_LABEL[s.env]}</span>
              {s.label ? (
                <span title={s.sub ? `${s.label} — ${s.sub}` : undefined} className="min-w-0"><TechInk label={s.label} /></span>
              ) : (
                <span className="typo-caption text-foreground/25 leading-none" title={`${ENV_LABEL[s.env]}: no source or config known in the codebase`}>—</span>
              )}
            </span>
          ))}
        </span>
      );
    }
    case 'cost': {
      if (value.state === 'missing') {
        return (
          <span className="inline-flex flex-col gap-0.5 min-w-0" title={`No ${APP_COST_FILENAME} in the repo — the gear dispatches an agent to create it`} data-testid="app-cost-missing">
            <span className="typo-caption font-medium text-foreground/45">NA</span>
            <span className="typo-label text-foreground/35">no cost file</span>
          </span>
        );
      }
      if (value.state === 'empty') {
        return (
          <span
            className="typo-caption font-medium"
            style={{ color: INK.blue }}
            title={value.invalid ? `${APP_COST_FILENAME} isn't valid JSON — fix it by hand` : `${APP_COST_FILENAME} exists — add your services and monthly costs by hand`}
          >
            {value.invalid ? 'invalid cost file' : 'add services →'}
          </span>
        );
      }
      const services = value.services ?? [];
      const unpriced = services.filter((s) => s.monthly == null).length;
      const amount = value.currency && value.currency !== 'USD'
        ? `${value.total ?? 0} ${value.currency}`
        : formatCost(value.total ?? 0);
      return (
        <span
          className="inline-flex flex-col gap-0.5 min-w-0"
          title={services.map((s) => `${s.name}: ${s.monthly == null ? '?' : s.monthly}${s.note ? ` (${s.note})` : ''}`).join(' · ')}
          data-testid="app-cost-cell"
        >
          <span className="typo-caption font-semibold text-foreground/90 tabular-nums">{amount}/mo</span>
          <span className="typo-label text-foreground/45 truncate">
            {services.length} service{services.length === 1 ? '' : 's'}{unpriced > 0 ? ` · ${unpriced} unpriced` : ''}
          </span>
        </span>
      );
    }
  }
}

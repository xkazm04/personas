// The DOM overlay every 3D variant shares: layer breadcrumb (L0 → L1 → L2),
// the right-dock card for the focused project / dimension, Athena's operating
// bar with her transcript, and the status legend. Skinned by the variant's
// palette through --w-* custom properties (world.css), so the three worlds
// each get their own typography and colour with one HUD implementation.
import type { ReactNode } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

import { DIM_REGISTRY, type DimCategory, type DimKey } from '../lib/dimRegistry';
import type { DimStatus } from '../lib/types';

import { ATHENA_CHIP_KEY, ATHENA_COMMANDS } from './athenaOps';
import { attentionDims, dimProgress, dimsByCategory, findProject, type World, type WorldDim, type WorldProject } from './mockWorld';
import type { WorldPalette, WorldVariant } from './palettes';
import type { WorldNav } from './useWorldNav';
import { nodeId } from './worldModel';

const LEGEND_ORDER: DimStatus[] = ['solid', 'partial', 'risk', 'alert', 'unknown', 'absent'];

export const statusLabel = (t: Translations, s: DimStatus): string =>
  ({
    solid: t.mastermind.legend_solid,
    partial: t.mastermind.legend_partial,
    risk: t.mastermind.legend_risk,
    alert: t.mastermind.legend_alert,
    unknown: t.mastermind.legend_unknown,
    absent: t.mastermind.legend_absent,
  })[s];

export const categoryLabel = (t: Translations, c: DimCategory): string =>
  ({ runtime: t.mastermind.dim_cat_runtime, delivery: t.mastermind.dim_cat_delivery, agentic: t.mastermind.dim_cat_agentic, product: t.mastermind.dim_cat_product })[c];

const fleetStateLabel = (t: Translations, s: string): string =>
  ({ running: t.mastermind.fleet_running, awaiting_input: t.mastermind.fleet_awaiting, idle: t.mastermind.fleet_idle, stale: t.mastermind.fleet_stale })[s] ?? s;

const variantNote = (t: Translations, v: WorldVariant): { name: string; note: string } =>
  ({
    strata: { name: t.mastermind.view_strata, note: t.mastermind.view_strata_note },
    holo: { name: t.mastermind.view_holo, note: t.mastermind.view_holo_note },
  })[v];

/** Resolve a transcript line's key + params into copy. Keys are the flat
 *  `mastermind.*` names the scripts emit. */
function lineText(t: Translations, tx: (s: string, p: Record<string, string | number>) => string, key: string, params?: Record<string, string | number>): string {
  const section = t.mastermind as unknown as Record<string, string>;
  const raw = section[key] ?? key;
  return params ? tx(raw, params) : raw;
}

/** Effective dim after Athena's overrides. */
export function effectiveDim(nav: WorldNav, slug: string, d: WorldDim): WorldDim {
  const o = nav.state.overrides[nodeId(slug, d.key)];
  return o ? { ...d, status: o.status, detail: o.detail, figure: o.figure, reached: d.steps, } : d;
}

export function WorldHud({ world, nav, palette, variant }: { world: World; nav: WorldNav; palette: WorldPalette; variant: WorldVariant }) {
  const { t, tx } = useTranslation();
  const { focus, transcript, athenaBusy } = nav.state;
  const project = focus.project ? findProject(world, focus.project) : undefined;
  const dim = project && focus.dim ? project.dims.find((d) => d.key === focus.dim) : undefined;
  const info = variantNote(t, variant);

  const hint = focus.level === 0 ? t.mastermind.world_hint_l0 : focus.level === 1 ? t.mastermind.world_hint_l1 : t.mastermind.world_hint_l2;

  return (
    <div className="mm3d-hud" data-testid="mm3d-hud">
      <nav className="mm3d-crumbs" aria-label={t.mastermind.world_layers}>
        <button type="button" className="mm3d-crumb" onClick={nav.home} aria-current={focus.level === 0 ? 'page' : undefined}>
          {t.mastermind.world_portfolio}
        </button>
        {project && (
          <>
            <span className="mm3d-crumb-sep" aria-hidden>›</span>
            <button type="button" className="mm3d-crumb" onClick={() => nav.openProject(project.slug)} aria-current={focus.level === 1 ? 'page' : undefined}>
              {project.name}
            </button>
          </>
        )}
        {dim && (
          <>
            <span className="mm3d-crumb-sep" aria-hidden>›</span>
            <button type="button" className="mm3d-crumb" aria-current="page">
              {DIM_REGISTRY[dim.key].label}
            </button>
          </>
        )}
        <span className="mm3d-level mm3d-mono">L{focus.level}</span>
      </nav>

      <p className="mm3d-note">
        <b>{info.name}</b> · {info.note}
      </p>

      {project && !dim && <ProjectCard project={project} nav={nav} palette={palette} />}
      {project && dim && <DimCard project={project} dim={effectiveDim(nav, project.slug, dim)} palette={palette} />}

      <div className="mm3d-legend" aria-label={t.mastermind.legend_title}>
        {LEGEND_ORDER.map((s) => (
          <span key={s}>
            <i className="mm3d-dot" style={{ '--w-dot': palette.status[s] } as React.CSSProperties} aria-hidden />
            {statusLabel(t, s)}
          </span>
        ))}
      </div>

      <div className="mm3d-athena" data-testid="mm3d-athena">
        <div className="mm3d-athena-head mm3d-caps">
          <strong>Athena</strong>
          {athenaBusy ? <i className="mm3d-busy" aria-hidden /> : null}
          <span className="mm3d-dim">{athenaBusy ? t.mastermind.athena_operating : t.mastermind.athena_ready}</span>
          <span className="mm3d-dim" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>{hint}</span>
        </div>
        <div className="mm3d-chips" role="group" aria-label={t.mastermind.athena_commands}>
          {ATHENA_COMMANDS.map((cmd) => (
            <button key={cmd} type="button" className="mm3d-chip" disabled={athenaBusy} onClick={() => nav.runAthena(cmd)} data-testid={`mm3d-athena-${cmd}`}>
              {lineText(t, tx, ATHENA_CHIP_KEY[cmd])}
            </button>
          ))}
        </div>
        {/* The live region is always mounted (empty until Athena speaks) so a
            screen reader has registered it BEFORE the first line lands. */}
        <ul className="mm3d-transcript" aria-live="polite" hidden={transcript.length === 0}>
          {transcript.slice(-3).map((line) => (
            <li key={line.id} data-who={line.who}>
              <span>{line.who === 'athena' ? 'Athena' : t.mastermind.transcript_you}</span>
              <span>{lineText(t, tx, line.key, line.params)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="mm3d-row">
      <span className="mm3d-row-k">{k}</span>
      <span className="mm3d-row-v">{children}</span>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <Row k={label}><Numeric value={value} unit="percent" precision={0} /></Row>
      <div className="mm3d-bar" style={{ '--w-bar': color } as React.CSSProperties}><i style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function ProjectCard({ project, nav, palette }: { project: WorldProject; nav: WorldNav; palette: WorldPalette }) {
  const { t, tx } = useTranslation();
  const attention = attentionDims(project);
  const stateColor = palette.state[project.state];
  return (
    <aside className="mm3d-card" data-testid="mm3d-project-card">
      <span className="mm3d-card-eyebrow mm3d-mono mm3d-caps">{project.tag} · {project.lifecycle}</span>
      <h3 className="mm3d-card-title">{project.name}</h3>
      <p className="mm3d-card-sub">{project.purpose}</p>
      <span className="mm3d-pill" style={{ '--w-pill': stateColor } as React.CSSProperties}>
        <i className="mm3d-dot" style={{ '--w-dot': stateColor } as React.CSSProperties} aria-hidden />
        {tx(t.mastermind.world_attention_count, { count: attention.length })}
      </span>
      <div className="mm3d-rule" />
      <ScoreBar label={t.mastermind.world_auto_score} value={project.autoScore} color={palette.primary} />
      <ScoreBar label={t.mastermind.world_prod_score} value={project.prodScore} color={palette.accent} />
      <Row k={t.mastermind.world_llm_spend}><Numeric value={project.llmSpend30d} unit="usd" precision={0} /></Row>
      <Row k={t.mastermind.world_next_ship}>
        {project.ship.next ?? '—'} · {project.ship.shipped}/{project.ship.total}
        {project.ship.late ? <span style={{ color: palette.status.risk }}> · {t.mastermind.world_late}</span> : null}
      </Row>
      <div className="mm3d-rule" />
      <span className="mm3d-row-k">{t.mastermind.world_fleet}</span>
      <ul className="mm3d-list">
        {project.fleet.map((f) => (
          <li key={f.id}>
            <i className="mm3d-dot" style={{ '--w-dot': palette.fleet[f.state] } as React.CSSProperties} aria-hidden />
            <span className="mm3d-mono">{f.name}</span>
            <span className="mm3d-dim">{fleetStateLabel(t, f.state)}</span>
          </li>
        ))}
        {project.personasRunning.map((p) => (
          <li key={p}>
            <i className="mm3d-dot" style={{ '--w-dot': palette.primary } as React.CSSProperties} aria-hidden />
            <span>{p}</span>
            <span className="mm3d-dim">{t.mastermind.world_persona_running}</span>
          </li>
        ))}
      </ul>
      <div className="mm3d-rule" />
      {dimsByCategory(project).map(({ category, dims }) => (
        <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span className="mm3d-row-k">{categoryLabel(t, category)}</span>
          <div className="mm3d-dims">
            {dims.map((raw) => {
              const d = effectiveDim(nav, project.slug, raw);
              return (
                <button
                  key={d.key}
                  type="button"
                  className="mm3d-dim-chip"
                  style={{ '--w-dot': palette.status[d.status] } as React.CSSProperties}
                  onClick={() => nav.openDim(project.slug, d.key)}
                  onMouseEnter={() => nav.hover(nodeId(project.slug, d.key))}
                  onMouseLeave={() => nav.hover(null)}
                >
                  <i className="mm3d-dot" aria-hidden />
                  {DIM_REGISTRY[d.key].label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}

function DimCard({ project, dim, palette }: { project: WorldProject; dim: WorldDim; palette: WorldPalette }) {
  const { t } = useTranslation();
  const entry = DIM_REGISTRY[dim.key];
  const color = palette.status[dim.status];
  const progress = dimProgress(dim);
  const Icon = entry.icon;
  return (
    <aside className="mm3d-card" data-testid="mm3d-dim-card">
      <span className="mm3d-card-eyebrow mm3d-mono mm3d-caps">{project.tag} · {categoryLabel(t, entry.category)}</span>
      <h3 className="mm3d-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Icon size={18} color={color} aria-hidden />
        {entry.label}
      </h3>
      <span className="mm3d-pill" style={{ '--w-pill': color } as React.CSSProperties}>
        <i className="mm3d-dot" style={{ '--w-dot': color } as React.CSSProperties} aria-hidden />
        {statusLabel(t, dim.status)}
      </span>
      <div className="mm3d-rule" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <Row k={t.mastermind.world_progress}>
          {dim.steps > 0 ? `${dim.reached} / ${dim.steps}` : <Numeric value={progress * 100} unit="percent" precision={0} />}
        </Row>
        <div className="mm3d-bar" style={{ '--w-bar': color } as React.CSSProperties}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      </div>
      <Row k={t.mastermind.world_tooling}>{dim.detail ?? t.mastermind.legend_absent}</Row>
      {dim.figure ? <Row k={t.mastermind.world_headline}>{dim.figure}</Row> : null}
      <div className="mm3d-rule" />
      <p className="mm3d-card-sub">{t.mastermind.world_dim_card_hint}</p>
    </aside>
  );
}

export type { DimKey };

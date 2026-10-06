// /prototype ProjectsLayer (2026-10-06) - a fork of PassportAtlas whose only
// difference is that the portfolio FIGURE is a prop. PassportAtlas renders
// AtlasPortfolio, which hard-wires MatrixFigure, and the prototype may not edit
// either; so the variants mount this host instead and hand it their figure.
// Everything else (layers, drawer, passport, modals, keys) is the original.
// Throwaway: it goes when the switcher is consolidated.
import { useMemo, useState, type ComponentType } from 'react';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { KitHost, Surface } from '@/features/shared/components/kit';
import { useFactoryHeadline } from './factoryHeadline';
import type { AppPassport } from './passport/passportModel';
import { onboardDispatchKey } from './passport/onboardDispatch';
import { ImprovePlanPanel } from './passport/improve/ImprovePlanPanel';
import { PassportActionsCell } from './passport/PassportActionsRow';
import { PassportTerminalModal, usePassportFleetSessions } from './passport/passportFleet';
import { RowSetupModal } from './passport/RowSetupModal';
import type { WallSetupTarget } from './passport/WallCompareTable';
import { blockersOf, displayNames, lensRows, portfolioFinding, sharedSetupRows, sortAtlas, type AtlasRow } from './passport/atlas/atlasModel';
import { AtlasCellDrawer } from './passport/atlas/AtlasCellDrawer';
import { AtlasPassport } from './passport/atlas/AtlasPassport';
import { AtlasPortfolioShell, type PortfolioView } from './passport/atlas/AtlasPortfolioShell';
import type { AtlasFigureProps } from './passport/atlas/atlasFigure';
import { ATLAS_WORDS as W } from './passport/atlas/atlasWords';
import './passport/atlas/atlas.css';

const ACTION_LABELS = { onboard: 'Onboard', populate: 'Populate', standards: 'Standards scan', copy: 'Copy report', rescan: 'Rescan', plan: 'Improve plan' } as const;

export function ProjectsLayerAtlasHost({ passports, onOpen, rescanningProject, onRescanProject, figure: Figure }: {
  passports: AppPassport[];
  /** Opens the project's own Factory workspace (L2). */
  onOpen?: (slug: string) => void;
  rescanningProject?: string | null;
  onRescanProject?: (slug: string) => void;
  /** The variant's drawing of the portfolio. */
  figure: ComponentType<AtlasFigureProps>;
}) {
  const [view, setView] = useState<PortfolioView>(() => ({
    lens: 'readiness', sort: 'production', query: '', unfold: false, at: { pi: 0, di: 0 },
  }));
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ slug: string; rowKey: string } | null>(null);
  const [setup, setSetup] = useState<WallSetupTarget | null>(null);
  const [terminalKey, setTerminalKey] = useState<string | null>(null);
  const [planSlug, setPlanSlug] = useState<string | null>(null);
  const fleetSessions = usePassportFleetSessions();

  const names = useMemo(() => displayNames(passports), [passports]);
  const sharedSetup = useMemo(() => sharedSetupRows(passports), [passports]);
  const folded = useMemo(() => new Set(view.unfold ? [] : sharedSetup.map((r) => r.key)), [view.unfold, sharedSetup]);
  const rows = useMemo(() => lensRows(view.lens, folded), [view.lens, folded]);
  const projects = useMemo(() => sortAtlas(passports, view.sort, view.query), [passports, view.sort, view.query]);
  const at = { pi: Math.min(view.at.pi, Math.max(0, projects.length - 1)), di: Math.min(view.at.di, Math.max(0, rows.length - 1)) };

  const project = projectSlug ? passports.find((p) => p.identity.slug === projectSlug) ?? null : null;
  const drawerTarget = useMemo(() => {
    if (!drawer) return null;
    const p = passports.find((x) => x.identity.slug === drawer.slug);
    const row = p && ([...rows, ...sharedSetup] as AtlasRow[]).find((r) => r.key === drawer.rowKey);
    return p && row ? { p, row } : null;
  }, [drawer, passports, rows, sharedSetup]);

  const finding = portfolioFinding(passports);
  const label = (p: AppPassport) => { const n = names.get(p.identity.slug); return n?.qualifier ? `${n.name} ${n.qualifier}` : p.identity.name; };
  useFactoryHeadline(project
    ? { eyebrow: W.eyebrowPassport, title: W.reasons(label(project), blockersOf(project).length) }
    : { eyebrow: W.eyebrowPortfolio, title: W.finding(finding.projects, finding.belowGolden, finding.failingDims) });

  const openProject = (slug: string) => { setDrawer(null); setProjectSlug(slug); };
  const step = (dir: -1 | 1) => {
    const i = projects.findIndex((p) => p.identity.slug === projectSlug);
    const next = projects[i + dir];
    if (next) setProjectSlug(next.identity.slug);
  };
  const doors = { fleetSessions, onOpenSetup: setSetup, onOpenTerminal: setTerminalKey };

  // Esc peels one layer: the drawer, then the passport (back to the saved coordinate).
  // [ and ] step through the portfolio's order inside a passport. Registered on
  // the app's keyboard ladder (the original attaches to window directly).
  useAppKeyboard((e) => {
    if (setup || terminalKey || planSlug) return false;
    const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
    if (e.key === 'Escape' && drawer) { e.preventDefault(); setDrawer(null); return true; }
    if ((e.key === 'p' || e.key === 'P') && drawer && !typing) { e.preventDefault(); openProject(drawer.slug); return true; }
    if (e.key === 'Escape' && projectSlug) { e.preventDefault(); setProjectSlug(null); return true; }
    if (typing || !projectSlug) return false;
    if (e.key === '[') { step(-1); return true; }
    if (e.key === ']') { step(1); return true; }
    return false;
  }, { priority: ROUTE_DECISION_PRIORITY });

  return (
    <KitHost testId="passport-atlas">
      <Surface dense>
        {project ? (
          <AtlasPassport
            p={project}
            name={names.get(project.identity.slug)?.name ?? project.identity.name}
            qualifier={names.get(project.identity.slug)?.qualifier ?? null}
            doors={doors}
            actions={
              <PassportActionsCell
                p={project}
                labels={ACTION_LABELS}
                onboardSession={fleetSessions.get(onboardDispatchKey(project.identity.slug)) ?? null}
                onOpenOnboardTerminal={() => setTerminalKey(onboardDispatchKey(project.identity.slug))}
                rescanning={rescanningProject === project.identity.slug}
                onRescanProject={() => onRescanProject?.(project.identity.slug)}
                onOpenPlan={() => setPlanSlug(project.identity.slug)}
              />
            }
            onBack={() => setProjectSlug(null)}
            onStep={step}
            hasPrev={projects[0]?.identity.slug !== project.identity.slug}
            hasNext={projects[projects.length - 1]?.identity.slug !== project.identity.slug}
            onOpenWorkspace={onOpen ? () => onOpen(project.identity.slug) : undefined}
          />
        ) : (
          <AtlasPortfolioShell
            all={passports}
            projects={projects}
            rows={rows}
            sharedSetup={sharedSetup}
            names={names}
            view={{ ...view, at }}
            onView={(patch) => setView((v) => ({ ...v, ...patch }))}
            figure={
              <Figure
                projects={projects}
                rows={rows}
                names={names}
                at={at}
                onMove={(next) => setView((v) => ({ ...v, at: next }))}
                onOpenCell={(c) => { const p = projects[c.pi]; const r = rows[c.di]; if (p && r) setDrawer({ slug: p.identity.slug, rowKey: r.key }); }}
                onOpenProject={openProject}
              />
            }
          />
        )}
      </Surface>

      <AtlasCellDrawer
        target={drawerTarget}
        name={drawerTarget ? label(drawerTarget.p) : ''}
        doors={doors}
        onClose={() => setDrawer(null)}
        onOpenPassport={openProject}
      />
      {planSlug && <ImprovePlanPanel open onClose={() => setPlanSlug(null)} slug={planSlug} />}
      {setup && (
        <RowSetupModal rowKey={setup.rowKey} rowLabel={setup.rowLabel} passport={setup.passport} currentLabel={setup.currentLabel} onDispatched={() => {}} onClose={() => setSetup(null)} />
      )}
      {terminalKey && (
        <PassportTerminalModal sessionId={fleetSessions.get(terminalKey)?.id ?? ''} session={fleetSessions.get(terminalKey) ?? null} onClose={() => setTerminalKey(null)} />
      )}
    </KitHost>
  );
}

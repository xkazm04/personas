// Passport Atlas — the two-layer successor to the passport wall, chosen by the
// owner in /contest passport-wall (2026-09-25): Signal Atlas as the baseline,
// Fault Lines' header (the finding in the page header), a drawer over the
// matrix for a cell, the project's name as the door to its passport, and the
// long explanations behind hints. Runs beside the legacy wall (tab switcher in
// ProjectsLayer) until it has been perfected.
//
// This host owns the layer (portfolio | one passport), the portfolio view
// state it restores on the way back, the drawer target and the row modals.
import { useEffect, useMemo, useState } from 'react';
import { KitHost, Surface } from '@/features/shared/components/kit';
import { useFactoryHeadline } from '../../factoryHeadline';
import type { AppPassport } from '../passportModel';
import { onboardDispatchKey } from '../onboardDispatch';
import { ImprovePlanPanel } from '../improve/ImprovePlanPanel';
import { PassportActionsCell } from '../PassportActionsRow';
import { PassportTerminalModal, usePassportFleetSessions } from '../passportFleet';
import { RowSetupModal } from '../RowSetupModal';
import type { WallSetupTarget } from '../WallCompareTable';
import { blockersOf, displayNames, lensRows, portfolioFinding, sharedSetupRows, sortAtlas, type AtlasRow } from './atlasModel';
import { AtlasCellDrawer } from './AtlasCellDrawer';
import { AtlasPassport } from './AtlasPassport';
import { AtlasPortfolio, type PortfolioView } from './AtlasPortfolio';
import { ATLAS_WORDS as W } from './atlasWords';
import './atlas.css';

const ACTION_LABELS = { onboard: 'Onboard', populate: 'Populate', standards: 'Standards scan', copy: 'Copy report', rescan: 'Rescan', plan: 'Improve plan' } as const;

export function PassportAtlas({ passports, onOpen, rescanningProject, onRescanProject }: {
  passports: AppPassport[];
  /** Opens the project's own Factory workspace (L2). */
  onOpen?: (slug: string) => void;
  rescanningProject?: string | null;
  onRescanProject?: (slug: string) => void;
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
  // [ and ] step through the portfolio's order inside a passport.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (setup || terminalKey || planSlug) return;
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (e.key === 'Escape' && drawer) { e.preventDefault(); setDrawer(null); return; }
      if ((e.key === 'p' || e.key === 'P') && drawer && !typing) { e.preventDefault(); openProject(drawer.slug); return; }
      if (e.key === 'Escape' && projectSlug) { e.preventDefault(); setProjectSlug(null); return; }
      if (typing || !projectSlug) return;
      if (e.key === '[') step(-1);
      if (e.key === ']') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <KitHost compact testId="passport-atlas">
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
          <AtlasPortfolio
            all={passports}
            projects={projects}
            rows={rows}
            sharedSetup={sharedSetup}
            names={names}
            view={{ ...view, at }}
            onView={(patch) => setView((v) => ({ ...v, ...patch }))}
            onOpenCell={(c) => { const p = projects[c.pi]; const r = rows[c.di]; if (p && r) setDrawer({ slug: p.identity.slug, rowKey: r.key }); }}
            onOpenProject={openProject}
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

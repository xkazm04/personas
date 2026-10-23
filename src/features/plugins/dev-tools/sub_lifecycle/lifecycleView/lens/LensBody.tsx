/**
 * The Lens (contest lifecycle-portfolio-r2, winner A/3, with the owner's two
 * changes; docs/design/lifecycle-lens/migration-plan.md): the development
 * practice of every project, as planes in depth.
 *
 *   L1 portfolio   every project x every step; a cell opens its project
 *   L3' across     one step across every project, full width (a leaf)
 *   L2 project     one project x every step, cells are its changes
 *   L3 detail      one step of one project, full width (the last layer)
 *
 * Above them, two rows that never change shape: the top bar (trail, depth,
 * keys, the project's actions) and the fixed-height header. A move between
 * planes is a camera move: the plane recedes and blurs, the next one arrives
 * from in front; under reduced motion it is a cut.
 *
 * Lifecycle keeps its own focused project (`route.projectId`); opening one
 * never changes the app-wide active project (owner, 2026-10-16).
 */
import { memo, useCallback, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import type { Crumb } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { GitBranch } from 'lucide-react';

import { stepLabel } from '../../journey/journeyLabels';
import { LifecycleViewProvider, useLifecycleViewModel } from '../context';
import { prefetchStepChunksOnIdle } from '../layer2/stepChunks';
import { usePortfolio } from './data/usePortfolio';
import { initialLensRoute, rememberLensRoute, useLensFocus } from './model/lensFocus';
import { lensDepth, lensReducer, type LensRoute } from './model/lensRoute';
import { columnName, type Dl } from './model/lensWords';
import { acrossRows, AcrossPlane } from './planes/AcrossPlane';
import { PortfolioPlane } from './planes/PortfolioPlane';
import { ProjectLens } from './ProjectLens';
import { LensActions } from './shell/LensActions';
import { FieldGhost } from './shell/FieldGhost';
import { LensHeader } from './shell/LensHeader';
import { useLensPointer } from './shell/lensPointer';
import { LensTopBar } from './shell/LensTopBar';
import { useLensHead } from './shell/useLensHead';
import { useLensKeys } from './shell/useLensKeys';
import '../layer1/layer1.css';
import './lens.css';

const CAMERA = { duration: 0.42, ease: [0.2, 0.8, 0.2, 1] as const };
const INTRO_MS = 1600;
/** Planes whose arrival has played this session; a remount paints still. */
const arrived = new Set<string>();

function planeKey(route: LensRoute, stepOpen: boolean): string {
  if (route.plane === 'project') return `${stepOpen ? 'detail' : 'project'}:${route.projectId}`;
  return route.plane === 'portfolioStep' ? `across:${route.stepId}` : 'portfolio';
}

function depthLabel(dl: Dl, depth: 0 | 1 | 2, plane: LensRoute['plane']): string {
  if (depth === 0) return dl.lens_depth_portfolio;
  if (depth === 2) return dl.lens_depth_detail;
  return plane === 'portfolioStep' ? dl.lens_depth_across : dl.lens_depth_project;
}

/** The route, plus the one-shot "open this project" requests other surfaces send. */
export function useLensRoute() {
  const [route, dispatch] = useReducer(lensReducer, undefined, initialLensRoute);
  const request = useLensFocus((s) => s.request);
  useEffect(() => {
    if (!request) return;
    const r = useLensFocus.getState().take();
    if (r) dispatch({ type: 'openProject', projectId: r.projectId, stepId: r.stepId });
  }, [request]);
  useEffect(() => { rememberLensRoute(route); }, [route]);
  return [route, dispatch] as const;
}

/**
 * Memoised: its props (the route and its dispatch) only change on a move, so a page render that
 * changed nothing in the view model - a revalidation bringing the same snapshot back - re-renders
 * nothing here (measured with scripts/style/lifecycle-perf.mjs).
 */
export const LensBody = memo(function LensBody({ route, dispatch }: {
  route: LensRoute;
  dispatch: Dispatch<Parameters<typeof lensReducer>[1]>;
}) {
  const model = useLifecycleViewModel();
  const { dl, tx, order, openStepId, openStep, closeStep } = model;
  const { portfolio, total, failed, loading } = usePortfolio();
  const reduced = useReducedMotion();
  const cursor = useLensPointer((s) => s.cursor);
  const setCursor = useLensPointer((s) => s.setCursor);
  const setHover = useLensPointer((s) => s.setHover);

  const open = route.plane === 'project' && openStepId ? order.find((n) => n.id === openStepId) ?? null : null;
  const key = planeKey(route, !!open);
  const depth = lensDepth(route, !!open);

  // The lit column: the route's step, else the portfolio's failing step, else the first.
  const columnIds = route.plane === 'project' ? order.map((n) => n.id) : portfolio?.columns.map((c) => c.id) ?? [];
  const seed = route.plane === 'project'
    ? portfolio?.projects.find((p) => p.id === route.projectId)?.weakest?.node.id ?? null
    : portfolio?.faultStepId ?? null;
  const litStepId = route.stepId && columnIds.includes(route.stepId) ? route.stepId : seed ?? columnIds[0] ?? null;
  const litColumn = portfolio?.columns.find((c) => c.id === litStepId) ?? null;

  // A detail's own ←/→ walk moves the lit column with it, so Esc lands on the step last read.
  useEffect(() => { if (openStepId) dispatch({ type: 'select', stepId: openStepId }); }, [openStepId, dispatch]);
  // A new plane starts with no item cursor and no pointer.
  useEffect(() => { setCursor(-1); setHover(null); }, [key, litStepId, setCursor, setHover]);
  useEffect(() => { if (route.plane === 'project') return prefetchStepChunksOnIdle(); }, [route.plane]);

  // The arrival: cells light column by column, once per plane per session; any key or click ends it.
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (reduced || arrived.has(key) || key.startsWith('detail') || key.startsWith('across')) { setIntro(false); return; }
    if (route.plane === 'portfolio' && !portfolio) return;
    arrived.add(key);
    setIntro(true);
    const t = window.setTimeout(() => setIntro(false), INTRO_MS);
    return () => window.clearTimeout(t);
  }, [key, reduced, route.plane, portfolio]);
  // Any key or press ends it (the keys arrive on the window, so `useLensKeys` ends it too).
  const endIntro = useCallback(() => setIntro(false), []);

  // Focus follows the plane: the lit column, so the keys and a screen reader start where the eye is.
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) return; // the step screen focuses its own title
    const t = window.setTimeout(() => {
      const el = route.plane === 'portfolioStep'
        ? hostRef.current?.querySelector<HTMLElement>('.lens-row')
        : hostRef.current?.querySelector<HTMLElement>(`#lens-col-${litStepId}`);
      el?.focus({ preventScroll: true });
    }, reduced ? 0 : CAMERA.duration * 1000);
    return () => window.clearTimeout(t);
  }, [key, open, litStepId, route.plane, reduced]);

  const ranked = portfolio?.projects ?? [];
  const openProject = useCallback((projectId: string, stepId?: string | null) => {
    dispatch({ type: 'openProject', projectId, stepId });
  }, [dispatch]);
  const toPortfolio = useCallback(() => { closeStep(); dispatch({ type: 'back' }); }, [closeStep, dispatch]);
  const selectStep = useCallback((stepId: string) => dispatch({ type: 'select', stepId }), [dispatch]);
  const openAcross = useCallback((stepId: string) => dispatch({ type: 'openStepAcross', stepId }), [dispatch]);

  // [ / ] walk the projects by attention; on a detail the same step reopens on the next project.
  const reopen = useRef<string | null>(null);
  useEffect(() => {
    if (reopen.current && order.some((n) => n.id === reopen.current)) { openStep(reopen.current); reopen.current = null; }
  }, [order, openStep]);
  const walkProject = route.plane === 'project' && ranked.length > 1 ? (d: -1 | 1) => {
    const i = ranked.findIndex((p) => p.id === route.projectId);
    const next = ranked[((i < 0 ? 0 : i) + d + ranked.length) % ranked.length]!;
    reopen.current = openStepId;
    openProject(next.id, litStepId);
  } : null;

  const items = route.plane === 'portfolio' ? litColumn?.rows.length ?? 0
    : route.plane === 'portfolioStep' ? (litColumn ? acrossRows(litColumn).length : 0)
    : Math.min(model.evidence.length, 20);
  useLensKeys({
    any: endIntro,
    field: !open,
    step: (d) => {
      const i = columnIds.indexOf(litStepId ?? '');
      const next = columnIds[(i + d + columnIds.length) % columnIds.length];
      if (next) dispatch({ type: 'select', stepId: next });
    },
    // Columns are drawn bottom-up, so ↑ climbs to the next cell; a list reads top-down.
    item: (d) => {
      if (!items) return;
      const step = route.plane === 'portfolioStep' ? d : (d === -1 ? 1 : -1);
      setCursor(Math.max(-1, Math.min(items - 1, cursor + step)));
    },
    enter: () => {
      if (!litStepId) return;
      if (route.plane === 'portfolio') {
        const row = cursor >= 0 ? litColumn?.rows[cursor] : null;
        if (row) openProject(row.project.id, litStepId);
        else dispatch({ type: 'openStepAcross', stepId: litStepId });
      } else if (route.plane === 'portfolioStep') {
        const row = litColumn && cursor >= 0 ? acrossRows(litColumn)[cursor] : null;
        if (row) openProject(row.project.id, litStepId);
      } else {
        openStep(litStepId);
      }
    },
    back: () => {
      if (cursor >= 0) { setCursor(-1); return; }
      if (route.plane !== 'portfolio') toPortfolio();
    },
    project: walkProject,
  });

  const { head, say } = useLensHead({ route, litStepId, stepOpen: open, portfolio, total, failed });

  const crumbs: Crumb[] = [{ label: dl.lens_crumb_root }];
  if (route.plane === 'portfolio') crumbs.push({ label: dl.lens_crumb_portfolio });
  else {
    crumbs.push({ label: dl.lens_crumb_portfolio, onPress: toPortfolio, testId: 'lens-crumb-portfolio' });
    if (route.plane === 'portfolioStep') crumbs.push({ label: litColumn ? columnName(dl, litColumn) : '' });
    else if (open) {
      crumbs.push({ label: model.projectName ?? '', onPress: closeStep, testId: 'lens-crumb-project' });
      crumbs.push({ label: stepLabel(dl, open.id, open.label) });
    } else crumbs.push({ label: model.projectName ?? '' });
  }

  const camera = reduced
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } }
    : {
        initial: { opacity: 0, scale: 1.04, filter: 'blur(4px)' },
        animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
        exit: { opacity: 0, scale: 0.94, filter: 'blur(6px)', pointerEvents: 'none' as const },
        transition: CAMERA,
      };

  let plane: ReactNode;
  if (route.plane === 'project') {
    plane = <ProjectLens litStepId={litStepId} intro={intro} onSelect={selectStep} />;
  } else if (portfolio && route.plane === 'portfolioStep' && litColumn) {
    plane = <AcrossPlane dl={dl} tx={tx} column={litColumn} name={columnName(dl, litColumn)} onOpenProject={(id) => openProject(id, litStepId)} />;
  } else if (portfolio) {
    plane = (
      <PortfolioPlane
        dl={dl} tx={tx} portfolio={portfolio} litStepId={litStepId} intro={intro}
        onSelect={selectStep}
        onOpenAcross={openAcross}
        onOpenProject={openProject}
      />
    );
  } else if (loading) {
    plane = <FieldGhost dl={dl} />;
  } else {
    plane = <EmptyState icon={GitBranch} size="lg" title={dl.lc_empty_title} subtitle={dl.lc_empty_subtitle} />;
  }

  return (
    <div className="lens-stage lcx-inks" ref={hostRef} onPointerDownCapture={intro ? endIntro : undefined} data-testid="lc-journey" data-plane={key.split(':')[0]}>
      <div className="lens-surface" aria-hidden />
      <LensTopBar
        dl={dl}
        crumbs={crumbs}
        depth={depth}
        depthLabel={depthLabel(dl, depth, route.plane)}
        keys={open ? 'detail' : route.plane === 'project' ? 'project' : 'portfolio'}
      />
      <LensHeader head={head} say={say} aside={route.plane === 'project' ? <LensActions /> : null} />
      <div className="lens-planes">
        <AnimatePresence initial={false} mode={reduced ? 'wait' : 'sync'}>
          <motion.section
            key={key}
            className={`lens-plane${open || route.plane === 'portfolioStep' ? ' lens-plane-scroll' : ''}`}
            data-testid={`lens-plane-${key.split(':')[0]}`}
            {...camera}
          >
            {/* Each plane carries the model it was rendered under. The outgoing plane is the element
                AnimatePresence kept, so it keeps that model while it recedes: the columns stay
                columns while the detail arrives over them, and the other way round. */}
            <LifecycleViewProvider model={model}>{plane}</LifecycleViewProvider>
          </motion.section>
        </AnimatePresence>
      </div>
    </div>
  );
});


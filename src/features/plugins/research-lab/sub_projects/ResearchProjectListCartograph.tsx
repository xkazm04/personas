/**
 * ResearchProjectListCartograph — wildcard variant.
 *
 * Mental model: a cartographer's field map. Each project is a marker placed
 * on a 2D plane where the X axis is research phase (scoping → complete) and
 * the Y axis is domain (CS, Bio, Chem, ...). The user sees instantly:
 *  - which domains have stalled projects (markers stuck near scoping)
 *  - which domains are productive (markers clustered near complete)
 *  - the "hot zones" of recent activity (recent projects glow brighter)
 *
 * Aesthetic: nautical chart with axis grid, marker pins, status as marker
 * fill colour, recency as glow. Click a marker to set active + jump to
 * literature.
 */
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { FolderSearch, Plus, MapPin, Pencil, Trash2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { Translations } from '@/i18n/en';
import type { ResearchProject } from '@/api/researchLab/researchLab';
import {
  domainLabel, projectStatusLabel, projectStatusColor,
  type ProjectStatus, type Domain, DOMAINS,
} from '../_shared/tokens';

const ResearchProjectForm = lazy(() => import('./ResearchProjectForm'));

const PHASES: ProjectStatus[] = [
  'scoping', 'literature_review', 'hypothesis', 'experiment',
  'analysis', 'writing', 'review', 'complete',
];

const PHASE_SHORT: Record<ProjectStatus, string> = {
  scoping: 'Scope', literature_review: 'Lit', hypothesis: 'Hyp',
  experiment: 'Exp', analysis: 'Anlz', writing: 'Wrt',
  review: 'Rev', complete: 'Done',
};

export default function ResearchProjectListCartograph() {
  const { t } = useTranslation();
  const projects = useSystemStore((s) => s.researchProjects);
  const fetchProjects = useSystemStore((s) => s.fetchResearchProjects);
  const deleteProject = useSystemStore((s) => s.deleteResearchProject);
  const setActiveProject = useSystemStore((s) => s.setActiveResearchProject);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ResearchProject | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const activeDomains = useMemo<(Domain | 'general')[]>(() => {
    const present = new Set<string>();
    projects.forEach((p) => present.add(p.domain ?? 'general'));
    return DOMAINS.filter((d) => present.has(d)) as (Domain | 'general')[];
  }, [projects]);

  // Compute per-cell positions so multiple projects in same cell jitter slightly.
  const placements = useMemo(() => {
    const buckets = new Map<string, ResearchProject[]>();
    projects.forEach((p) => {
      const phase = (PHASES.includes(p.status as ProjectStatus) ? p.status : 'scoping') as ProjectStatus;
      const domain = (activeDomains.includes((p.domain ?? 'general') as Domain | 'general')
        ? (p.domain ?? 'general')
        : activeDomains[0]) as Domain | 'general';
      const key = `${phase}::${domain}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(p);
      buckets.set(key, bucket);
    });
    const out = new Map<string, { x: number; y: number; project: ResearchProject }>();
    buckets.forEach((bucket, key) => {
      const [phase, domain] = key.split('::') as [ProjectStatus, Domain | 'general'];
      const phaseIdx = PHASES.indexOf(phase);
      const domainIdx = activeDomains.indexOf(domain);
      bucket.forEach((p, i) => {
        const total = bucket.length;
        const angle = (i / total) * Math.PI * 2;
        const radius = total > 1 ? 12 : 0;
        const offsetX = Math.cos(angle) * radius;
        const offsetY = Math.sin(angle) * radius;
        out.set(p.id, {
          x: phaseIdx,
          y: domainIdx,
          project: p,
        });
        out.set(`${p.id}::offset`, {
          x: offsetX,
          y: offsetY,
          project: p,
        });
      });
    });
    return out;
  }, [projects, activeDomains]);

  const pinnedProject = pinnedId ? projects.find((p) => p.id === pinnedId) : null;
  const hoverProject = hoverId ? projects.find((p) => p.id === hoverId) : null;
  const detailProject = pinnedProject ?? hoverProject;

  const handleOpen = (id: string) => {
    setActiveProject(id);
    setResearchLabTab('literature');
  };

  const handleDelete = async (id: string) => {
    try { await deleteProject(id); setPinnedId(null); }
    catch (err) { toastCatch('ProjectsCartograph:delete')(err); }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      <CartoBand
        t={t}
        projects={projects}
        onCreate={() => { setEditing(null); setShowForm(true); }}
      />

      <div className="flex-1 min-h-0 overflow-auto">
        {projects.length === 0 ? (
          <CartoEmpty t={t} onCreate={() => setShowForm(true)} />
        ) : activeDomains.length === 0 ? (
          <CartoEmpty t={t} onCreate={() => setShowForm(true)} />
        ) : (
          <div className="flex">
            <div className="flex-1 min-w-0 p-6">
              <CartographChart
                t={t}
                phases={PHASES}
                domains={activeDomains}
                placements={placements}
                hoverId={hoverId}
                pinnedId={pinnedId}
                onHover={setHoverId}
                onPin={(id) => setPinnedId((prev) => (prev === id ? null : id))}
              />
            </div>
            <div className="hidden xl:block w-80 flex-shrink-0 border-l border-border/40 p-6">
              <DetailPane
                project={detailProject ?? null}
                t={t}
                onOpen={handleOpen}
                onEdit={(p) => { setEditing(p); setShowForm(true); }}
                onDelete={handleDelete}
              />
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <Suspense fallback={null}>
          <ResearchProjectForm
            onClose={() => { setShowForm(false); setEditing(null); }}
            editing={editing ?? undefined}
          />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CartoBand({
  t, projects, onCreate,
}: {
  t: Translations;
  projects: ResearchProject[];
  onCreate: () => void;
}) {
  const completed = projects.filter((p) => p.status === 'complete').length;
  const active = projects.length - completed;
  return (
    <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015]">
      <div className="flex items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-card bg-primary/15 border border-primary/20 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-primary" />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="typo-section-title text-foreground truncate">
              {t.research_lab.projects}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-foreground/60">
              Cartograph · phase × domain
            </span>
          </div>
        </div>
        <div className="flex-1" />
        <div className="hidden md:flex items-center gap-5 typo-caption text-foreground tabular-nums">
          <Stat label="active" value={active} />
          <Stat label="complete" value={completed} accent />
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.research_lab.create_project}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className={`typo-data-lg ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/55">{label}</span>
    </div>
  );
}

function CartographChart({
  t, phases, domains, placements, hoverId, pinnedId, onHover, onPin,
}: {
  t: Translations;
  phases: ProjectStatus[];
  domains: (Domain | 'general')[];
  placements: Map<string, { x: number; y: number; project: ResearchProject }>;
  hoverId: string | null;
  pinnedId: string | null;
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
}) {
  const cellW = 80;
  const cellH = 60;
  const padL = 100; // y axis label width
  const padT = 36;
  const padR = 24;
  const padB = 36;
  const chartW = phases.length * cellW;
  const chartH = domains.length * cellH;
  const totalW = padL + chartW + padR;
  const totalH = padT + chartH + padB;

  const markers = Array.from(placements.entries())
    .filter(([k]) => !k.endsWith('::offset'))
    .map(([, v]) => v);

  return (
    <div className="rounded-card border border-border/40 bg-foreground/[0.015] p-4 overflow-x-auto">
      <svg
        width={totalW}
        height={totalH}
        className="block"
        role="img"
        aria-label="Project cartograph"
      >
        {/* Grid lines */}
        <g stroke="currentColor" className="text-foreground/15" strokeWidth={0.5}>
          {phases.map((_, i) => (
            <line
              key={`v${i}`}
              x1={padL + i * cellW}
              y1={padT}
              x2={padL + i * cellW}
              y2={padT + chartH}
            />
          ))}
          <line x1={padL + chartW} y1={padT} x2={padL + chartW} y2={padT + chartH} />
          {domains.map((_, i) => (
            <line
              key={`h${i}`}
              x1={padL}
              y1={padT + i * cellH}
              x2={padL + chartW}
              y2={padT + i * cellH}
            />
          ))}
          <line x1={padL} y1={padT + chartH} x2={padL + chartW} y2={padT + chartH} />
        </g>

        {/* Phase labels (X axis) */}
        <g>
          {phases.map((phase, i) => (
            <text
              key={phase}
              x={padL + i * cellW + cellW / 2}
              y={padT - 12}
              textAnchor="middle"
              className="fill-foreground/70"
              style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}
            >
              {PHASE_SHORT[phase]}
            </text>
          ))}
        </g>

        {/* Domain labels (Y axis) */}
        <g>
          {domains.map((d, i) => (
            <text
              key={d}
              x={padL - 10}
              y={padT + i * cellH + cellH / 2 + 4}
              textAnchor="end"
              className="fill-foreground/70"
              style={{ fontSize: 11 }}
            >
              {domainLabel(t, d)}
            </text>
          ))}
        </g>

        {/* Markers */}
        <g>
          {markers.map(({ x, y, project }) => {
            const offset = placements.get(`${project.id}::offset`);
            const cx = padL + x * cellW + cellW / 2 + (offset?.x ?? 0);
            const cy = padT + y * cellH + cellH / 2 + (offset?.y ?? 0);
            const isHover = hoverId === project.id;
            const isPinned = pinnedId === project.id;
            const isActive = isHover || isPinned;
            const colorClass = projectStatusColor(project.status);
            // Extract foreground colour from token-style class (e.g. "bg-emerald-500/20 text-emerald-300")
            const textCls = colorClass.split(' ').find((c) => c.startsWith('text-')) ?? 'text-primary';
            return (
              <motion.g
                key={project.id}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                onMouseEnter={() => onHover(project.id)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onPin(project.id)}
                style={{ cursor: 'pointer' }}
              >
                {isActive && (
                  <circle cx={cx} cy={cy} r={14} className={textCls} fill="currentColor" opacity={0.18} />
                )}
                <circle
                  cx={cx} cy={cy} r={7}
                  className={textCls}
                  fill="currentColor"
                  stroke="rgb(var(--color-background))"
                  strokeWidth={2}
                />
                {isPinned && (
                  <circle
                    cx={cx} cy={cy} r={11}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="text-primary"
                    strokeDasharray="3 2"
                  />
                )}
              </motion.g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function DetailPane({
  project, t, onOpen, onEdit, onDelete,
}: {
  project: ResearchProject | null;
  t: Translations;
  onOpen: (id: string) => void;
  onEdit: (p: ResearchProject) => void;
  onDelete: (id: string) => void;
}) {
  if (!project) {
    return (
      <div className="flex flex-col items-start gap-2 typo-caption text-foreground/55">
        <MapPin className="w-4 h-4 text-foreground/30" />
        <p>Hover or click a marker to inspect.</p>
        <p>Click again to unpin.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {project.domain && (
          <span className="px-2 py-0.5 typo-caption rounded-full bg-foreground/[0.06] text-foreground/85">
            {domainLabel(t, project.domain)}
          </span>
        )}
        <span className={`px-2 py-0.5 typo-caption rounded-full ${projectStatusColor(project.status)}`}>
          {projectStatusLabel(t, project.status)}
        </span>
      </div>
      <h3 className="typo-section-title text-foreground leading-tight">{project.name}</h3>
      {project.thesis && (
        <p className="typo-body text-foreground/85 italic leading-relaxed line-clamp-5">
          {project.thesis}
        </p>
      )}
      {project.description && !project.thesis && (
        <p className="typo-body text-foreground/85 leading-relaxed line-clamp-5">
          {project.description}
        </p>
      )}
      <div className="flex flex-col gap-2 pt-2">
        <button
          onClick={() => onOpen(project.id)}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-interactive typo-caption bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
        >
          Open project
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(project)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/[0.1] transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            {t.research_lab.edit_project}
          </button>
          <button
            onClick={() => onDelete(project.id)}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-status-error/10 text-status-error hover:bg-status-error/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CartoEmpty({ t, onCreate }: { t: Translations; onCreate: () => void }) {
  return (
    <div className="h-full min-h-[300px] flex items-center justify-center">
      <div className="max-w-md text-center space-y-4 px-6">
        <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
          <FolderSearch className="w-6 h-6 text-primary" />
        </div>
        <p className="typo-body-lg text-foreground">{t.research_lab.no_projects}</p>
        <p className="typo-body text-foreground/70">{t.research_lab.no_projects_hint}</p>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-interactive typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.research_lab.create_project}
        </button>
      </div>
    </div>
  );
}

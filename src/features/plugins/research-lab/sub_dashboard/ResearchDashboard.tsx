/**
 * ResearchDashboard — pipeline / process-flow view.
 *
 * Mental model: research is a directed pipeline. Show every project as a
 * chip docked at its current phase station. The user sees instantly where
 * work is piling up (e.g. "5 in literature_review, nothing yet in writing").
 *
 * Aesthetic: blueprint / engineering schematic. Stroked-only stations,
 * dotted connector rails, monospaced counters, primary-tinted accents only
 * on the actively-populated stations.
 */
import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Compass, BookOpen, Lightbulb, FlaskConical, LineChart, PenLine, Eye,
  CheckCircle2, ArrowRight, Plus, FolderSearch,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import type { ResearchProject } from '@/api/researchLab/researchLab';
import {
  domainLabel, type ProjectStatus, type Domain, DOMAINS,
} from '../_shared/tokens';

type PhaseId = ProjectStatus;

interface Phase {
  id: PhaseId;
  icon: LucideIcon;
  shortLabel: string;
}

function buildPhases(t: Translations): Phase[] {
  return [
    { id: 'scoping', icon: Compass, shortLabel: t.research_lab.status_scoping },
    { id: 'literature_review', icon: BookOpen, shortLabel: t.research_lab.status_literature_review },
    { id: 'hypothesis', icon: Lightbulb, shortLabel: t.research_lab.status_hypothesis },
    { id: 'experiment', icon: FlaskConical, shortLabel: t.research_lab.status_experiment },
    { id: 'analysis', icon: LineChart, shortLabel: t.research_lab.status_analysis },
    { id: 'writing', icon: PenLine, shortLabel: t.research_lab.status_writing },
    { id: 'review', icon: Eye, shortLabel: t.research_lab.status_review },
    { id: 'complete', icon: CheckCircle2, shortLabel: t.research_lab.status_complete },
  ];
}

export default function ResearchDashboard() {
  const { t } = useTranslation();
  const stats = useSystemStore((s) => s.researchDashboardStats);
  const fetchStats = useSystemStore((s) => s.fetchResearchDashboardStats);
  const projects = useSystemStore((s) => s.researchProjects);
  const fetchProjects = useSystemStore((s) => s.fetchResearchProjects);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);
  const setActiveProject = useSystemStore((s) => s.setActiveResearchProject);

  useEffect(() => {
    fetchStats();
    fetchProjects();
  }, [fetchStats, fetchProjects]);

  const phases = useMemo(() => buildPhases(t), [t]);

  const projectsByPhase = useMemo(() => {
    const map = new Map<PhaseId, ResearchProject[]>();
    phases.forEach((p) => map.set(p.id, []));
    projects.forEach((proj) => {
      const phase = (proj.status as PhaseId) ?? 'scoping';
      const bucket = map.get(phase);
      if (bucket) bucket.push(proj);
      else map.get('scoping')!.push(proj);
    });
    return map;
  }, [projects, phases]);

  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    projects.forEach((p) => {
      const d = p.domain ?? 'general';
      counts.set(d, (counts.get(d) ?? 0) + 1);
    });
    return counts;
  }, [projects]);

  const totalProjects = stats?.totalProjects ?? 0;
  const activeProjects = stats?.activeProjects ?? 0;
  const completedCount = projectsByPhase.get('complete')?.length ?? 0;
  const completionPct = totalProjects > 0 ? Math.round((completedCount / totalProjects) * 100) : 0;

  const openProject = (id: string) => {
    setActiveProject(id);
    setResearchLabTab('literature');
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      {/* Identity band */}
      <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015]">
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-card bg-primary/15 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <FlaskConical className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="typo-section-title text-foreground truncate">
                {t.research_lab.dashboard}
              </span>
              <span className="text-xs uppercase tracking-[0.2em] text-foreground/60">
                Research pipeline
              </span>
            </div>
          </div>
          <div className="flex-1" />
          <div className="hidden sm:flex items-center gap-5 typo-caption text-foreground tabular-nums">
            <Counter label={t.research_lab.projects} value={totalProjects} />
            <Counter label={t.research_lab.active} value={activeProjects} />
            <Counter label="completion" value={`${completionPct}%`} accent />
          </div>
          <button
            onClick={() => setResearchLabTab('projects')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.research_lab.create_project}
          </button>
        </div>
      </div>

      {/* Bench — phase stations */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-8">
        {projects.length === 0 ? (
          <BenchEmptyState
            t={t}
            onCreate={() => setResearchLabTab('projects')}
          />
        ) : (
          <>
            <div className="relative">
              {/* Connector rail behind stations */}
              <div
                aria-hidden
                className="absolute left-6 right-6 top-[34px] h-px"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(to right, currentColor 0 4px, transparent 4px 10px)',
                  color: 'rgb(var(--color-foreground) / 0.18)',
                }}
              />

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 relative">
                {phases.map((phase, idx) => {
                  const items = projectsByPhase.get(phase.id) ?? [];
                  return (
                    <PhaseStation
                      key={phase.id}
                      index={idx}
                      phase={phase}
                      items={items}
                      onOpenProject={openProject}
                      t={t}
                    />
                  );
                })}
              </div>
            </div>

            {/* Domain distribution strip */}
            <div className="mt-10 pt-6 border-t border-border/40">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs uppercase tracking-[0.2em] text-foreground/60">
                  Domains
                </h3>
                <span className="typo-caption text-foreground/60 tabular-nums">
                  {projects.length} total
                </span>
              </div>
              <DomainStrip
                t={t}
                counts={domainCounts}
                total={projects.length}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Counter({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span
        className={`typo-data-lg ${accent ? 'text-primary' : 'text-foreground'}`}
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/55">
        {label}
      </span>
    </div>
  );
}

function PhaseStation({
  index, phase, items, onOpenProject, t,
}: {
  index: number;
  phase: Phase;
  items: ResearchProject[];
  onOpenProject: (id: string) => void;
  t: Translations;
}) {
  const populated = items.length > 0;
  const Icon = phase.icon;
  const visible = items.slice(0, 3);
  const overflow = items.length - visible.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.025, ease: 'easeOut' }}
      className="flex flex-col items-center"
    >
      {/* Station node */}
      <div
        className={`relative w-[68px] h-[68px] rounded-full flex items-center justify-center mb-3 transition-colors ${
          populated
            ? 'bg-primary/10 border border-primary/40'
            : 'bg-foreground/[0.025] border border-border/40'
        }`}
      >
        <Icon
          className={`w-5 h-5 ${
            populated ? 'text-primary' : 'text-foreground/40'
          }`}
        />
        {populated && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-primary text-background typo-caption font-semibold tabular-nums flex items-center justify-center">
            {items.length}
          </span>
        )}
      </div>

      {/* Phase label */}
      <span className={`typo-card-label text-center mb-2 ${populated ? 'text-foreground' : 'text-foreground/55'}`}>
        {phase.shortLabel}
      </span>

      {/* Project chips at this station */}
      <div className="flex flex-col gap-1.5 w-full">
        {visible.map((p) => (
          <button
            key={p.id}
            onClick={() => onOpenProject(p.id)}
            className="w-full text-left px-2 py-1.5 rounded-input bg-secondary/40 border border-border/30 hover:border-primary/40 hover:bg-secondary/70 transition-colors group"
            title={p.thesis ?? p.name}
          >
            <p className="typo-caption text-foreground truncate">
              {p.name}
            </p>
            {p.domain && (
              <p className="text-[10px] tracking-wide text-foreground/55 truncate">
                {domainLabel(t, p.domain)}
              </p>
            )}
          </button>
        ))}
        {overflow > 0 && (
          <span className="px-2 py-1 typo-caption text-foreground/55 text-center">
            +{overflow}
          </span>
        )}
        {!populated && (
          <span className="px-2 py-1 typo-caption text-foreground/40 text-center">
            —
          </span>
        )}
      </div>
    </motion.div>
  );
}

function DomainStrip({
  t, counts, total,
}: {
  t: Translations;
  counts: Map<string, number>;
  total: number;
}) {
  const entries = useMemo(() => {
    const all: Array<{ domain: Domain | 'general'; count: number }> = DOMAINS.map(
      (d) => ({ domain: d, count: counts.get(d) ?? 0 }),
    );
    return all.filter((e) => e.count > 0).sort((a, b) => b.count - a.count);
  }, [counts]);

  if (entries.length === 0) {
    return (
      <p className="typo-caption text-foreground/55">
        {t.research_lab.no_projects}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-px rounded-interactive overflow-hidden h-7 border border-border/40 bg-background">
      {entries.map((e, i) => {
        const pct = total > 0 ? (e.count / total) * 100 : 0;
        return (
          <div
            key={e.domain}
            className="h-full flex items-center justify-center px-2 typo-caption text-foreground tabular-nums whitespace-nowrap"
            style={{
              width: `${pct}%`,
              minWidth: '5%',
              backgroundColor: domainTint(i),
            }}
            title={`${domainLabel(t, e.domain)} · ${e.count}`}
          >
            <span className="truncate">
              {domainLabel(t, e.domain)} {e.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const DOMAIN_TINTS = [
  'rgb(var(--color-primary) / 0.22)',
  'rgb(var(--color-primary) / 0.16)',
  'rgb(var(--color-primary) / 0.12)',
  'rgb(var(--color-primary) / 0.08)',
];
function domainTint(idx: number) {
  return DOMAIN_TINTS[idx % DOMAIN_TINTS.length];
}

function BenchEmptyState({ t, onCreate }: { t: Translations; onCreate: () => void }) {
  return (
    <div className="h-full min-h-[300px] flex items-center justify-center">
      <div className="max-w-md text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
          <FolderSearch className="w-6 h-6 text-primary" />
        </div>
        <div className="space-y-2">
          <p className="typo-body-lg text-foreground">{t.research_lab.no_projects}</p>
          <p className="typo-body text-foreground/70 max-w-sm mx-auto">
            {t.research_lab.no_projects_hint}
          </p>
        </div>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-interactive typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.research_lab.create_project}
          <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </button>
      </div>
    </div>
  );
}

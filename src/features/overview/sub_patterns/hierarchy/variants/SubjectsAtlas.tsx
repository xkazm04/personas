// VARIANT: Atlas — spatial drill-down: category plates → subject cards → dossier.
//
// Metaphor: a map of the territory. 143 subjects don't fit a flat 320px rail —
// the Atlas navigates by CATEGORY first (a band of plates with real counts),
// then shows that category's subjects as summary cards you can actually read
// before committing, and only then opens one subject as a full-width dossier
// with a stat band. Browsing and reading are two different modes, and the
// Atlas gives each one the whole canvas instead of splitting the screen 24/7.
/* eslint-disable custom/no-hardcoded-jsx-text -- prototype-only labels; the
   winner's strings are extracted to i18n at consolidation */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import type { HierarchySubject } from '@/lib/bindings/HierarchySubject';
import type { HierarchyTechnique } from '@/lib/bindings/HierarchyTechnique';

import { HierarchyStatusChip } from '../HierarchyStatusChip';
import {
  categoryIcon,
  InlineDocBody,
  LawChips,
  STACK_CLASSES,
  STACK_FALLBACK,
  visibleGroupsOf,
  type SubjectsVariantProps,
} from './shared';

type AtlasMode = 'browse' | 'read';

export function SubjectsAtlas(props: SubjectsVariantProps) {
  const { t } = useTranslation();
  const p = t.overview.patterns_v2;
  const {
    projectId, graph, groups, selectedSlug, onSelect, matchMap,
    adherence, focus, onLinkHref, onOpenDoc, onOpenLaw,
  } = props;

  const [mode, setMode] = useState<AtlasMode>('browse');
  const [categoryId, setCategoryId] = useState<string | null>(groups[0]?.id ?? null);

  // A cross-link (or external selection while browsing) opens the dossier.
  useEffect(() => {
    if (focus && selectedSlug) setMode('read');
  }, [focus, selectedSlug]);

  const subject = useMemo(
    () => graph.subjects.find((s) => s.slug === selectedSlug) ?? null,
    [graph.subjects, selectedSlug],
  );

  const categoryTitle = useMemo(() => {
    // Bound rather than chained: a subject whose category row is gone must not
    // render identically to a subject that has no category at all.
    if (!subject) return null;
    const category = graph.categories.find((c) => c.id === subject.category);
    return category ? category.title : null;
  }, [graph.categories, subject]);

  // Reading a subject from another category re-anchors the plate band.
  useEffect(() => {
    if (mode === 'read' && subject && subject.category !== categoryId) {
      setCategoryId(subject.category ?? null);
    }
  }, [mode, subject, categoryId]);

  const visibleGroups = visibleGroupsOf(groups, matchMap);
  const searching = matchMap !== null;

  // While searching, the grid shows matches across ALL categories.
  const gridSubjects: HierarchySubject[] = useMemo(() => {
    if (searching) return visibleGroups.flatMap((g) => g.subjects);
    return groups.find((g) => g.id === categoryId)?.subjects ?? [];
  }, [searching, visibleGroups, groups, categoryId]);

  const openSubject = (slug: string) => {
    onSelect(slug);
    setMode('read');
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-card border border-border/40 bg-background/40 overflow-hidden animate-fade-in">
      {mode === 'browse' ? (
        <>
          {/* ── Plate band: one plate per category ─────────────────────── */}
          {!searching && (
            <div className="flex-shrink-0 flex gap-2 px-4 pt-4 pb-3 overflow-x-auto">
              {groups.map((g) => {
                const Icon = categoryIcon(g.id);
                const active = g.id === categoryId;
                return (
                  <button
                    key={g.id ?? '__unassigned'}
                    type="button"
                    onClick={() => setCategoryId(g.id)}
                    aria-pressed={active}
                    className={`flex-shrink-0 flex items-center gap-2.5 rounded-card border px-3.5 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-primary/50 bg-primary/10 shadow-elevation-1'
                        : 'border-border/50 bg-secondary/20 hover:border-border hover:bg-secondary/40'
                    }`}
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-primary' : 'text-foreground/50'}`} aria-hidden />
                    <span>
                      <span className={`block typo-body ${active ? 'text-foreground' : 'text-foreground/80'}`}>
                        {g.id === null ? p.category_unassigned : g.title}
                      </span>
                      {/* muted-ok: plate count micro-label */}
                      <span className="block typo-caption text-muted-foreground tabular-nums">{g.subjects.length}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Subject card grid ──────────────────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-1">
            {gridSubjects.length === 0 ? (
              <p className="typo-body text-foreground p-4">{p.search_no_matches}</p>
            ) : (
              <AtlasGrid
                key={searching ? '__search' : categoryId ?? '__unassigned'}
                subjects={gridSubjects}
                adherence={adherence}
                matchMap={matchMap}
                onOpen={openSubject}
              />
            )}
          </div>
        </>
      ) : subject ? (
        /* ── Dossier: one subject, whole canvas ───────────────────────── */
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[900px] mx-auto px-6 py-5">
            <button
              type="button"
              onClick={() => setMode('browse')}
              className="inline-flex items-center gap-1.5 typo-body text-foreground/70 hover:text-foreground rounded-interactive px-2 py-1 -ml-2 hover:bg-secondary/40 transition-colors mb-4"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
              {categoryTitle ?? p.lane_subjects}
            </button>

            <AtlasDossier
              projectId={projectId}
              subject={subject}
              graphProps={props}
              onLinkHref={onLinkHref}
              onOpenDoc={onOpenDoc}
              onOpenLaw={onOpenLaw}
              onSelect={openSubject}
              focus={focus}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="typo-body text-foreground">{p.select_subject_hint}</p>
        </div>
      )}
    </div>
  );
}

function AtlasGrid({
  subjects,
  adherence,
  matchMap,
  onOpen,
}: {
  subjects: HierarchySubject[];
  adherence: SubjectsVariantProps['adherence'];
  matchMap: SubjectsVariantProps['matchMap'];
  onOpen: (slug: string) => void;
}) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;
  const enter = useRevealTracker();

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
      {subjects.map((s, i) => {
        const info = matchMap?.get(s.slug);
        const score = adherence?.get(s.slug);
        const techniqueCount = s.techniques.length + s.sharedTechniques.length;
        return (
          <RevealItem key={s.slug} revealId={s.slug} order={i} {...enter} as="div">
            <button
              type="button"
              onClick={() => onOpen(s.slug)}
              className="w-full h-full text-left rounded-card border border-border/50 bg-secondary/20 px-4 py-3.5 hover:border-primary/40 hover:bg-secondary/35 hover:shadow-elevation-1 transition-all flex flex-col"
            >
              <span className="flex items-center gap-2 mb-1">
                <span className="typo-body text-foreground flex-1 truncate">{s.title}</span>
                <HierarchyStatusChip status={s.status} />
              </span>
              {s.summary && (
                <span className="typo-body text-foreground/75 leading-snug line-clamp-3 flex-1">
                  {s.summary}
                </span>
              )}
              {info && !info.direct && info.childHint && (
                <span className="block typo-caption text-primary/80 truncate mt-1.5">
                  {tx(p.rail_matched_in, { label: info.childHint })}
                </span>
              )}
              <span className="flex items-center gap-3 mt-2.5 pt-2 border-t border-border/40">
                {/* muted-ok: card footer counts, structural micro-labels */}
                <span className="typo-caption text-foreground/50 tabular-nums">
                  {tx(p.rail_counts, { techniques: techniqueCount, applications: s.applications.length })}
                </span>
                {s.deviations.length > 0 && (
                  <span className="inline-flex items-center gap-1 typo-caption text-status-warning ml-auto">
                    <AlertTriangle className="w-3 h-3" aria-hidden />
                    {s.deviations.length}
                  </span>
                )}
                {score && score.sites > 0 && (
                  // muted-ok: census micro-badge
                  <span className={`typo-caption tabular-nums ${s.deviations.length > 0 ? '' : 'ml-auto'} text-muted-foreground`}>
                    {score.sites}
                  </span>
                )}
              </span>
            </button>
          </RevealItem>
        );
      })}
    </div>
  );
}

function AtlasDossier({
  projectId,
  subject,
  graphProps,
  onLinkHref,
  onOpenDoc,
  onOpenLaw,
  onSelect,
  focus,
}: {
  projectId: string;
  subject: HierarchySubject;
  graphProps: SubjectsVariantProps;
  onLinkHref: SubjectsVariantProps['onLinkHref'];
  onOpenDoc: SubjectsVariantProps['onOpenDoc'];
  onOpenLaw: SubjectsVariantProps['onOpenLaw'];
  onSelect: (slug: string) => void;
  focus: SubjectsVariantProps['focus'];
}) {
  const { t } = useTranslation();
  const p = t.overview.patterns_v2;
  const { graph } = graphProps;

  type Pane = 'golden_path' | 'techniques' | 'applications' | 'evidence';
  const [pane, setPane] = useState<Pane>('golden_path');
  const [openTech, setOpenTech] = useState<string | null>(null);
  const [openApp, setOpenApp] = useState<string | null>(null);

  useEffect(() => {
    setPane('golden_path');
    setOpenTech(null);
    setOpenApp(null);
  }, [subject.slug]);

  useEffect(() => {
    if (!focus) return;
    if (focus.kind === 'technique') { setPane('techniques'); setOpenTech(focus.technique); }
    else { setPane('applications'); setOpenApp(focus.file); }
  }, [focus]);

  const techniques = useMemo(() => {
    const local = graph.techniques
      .filter((tech) => tech.subject === subject.slug)
      .map((tech) => ({ tech, owner: null as string | null }));
    const shared = subject.sharedTechniques
      .map((ref) => {
        const tech = graph.techniques.find((c) => c.subject === ref.owner && c.slug === ref.technique);
        return tech ? { tech, owner: ref.owner } : null;
      })
      .filter((x): x is { tech: HierarchyTechnique; owner: string } => x !== null);
    return [...local, ...shared];
  }, [graph.techniques, subject]);

  // `value` is nullable so an UNMEASURED count is representable. A tile that can
  // only take a number forces absence to be destroyed as a 0 at the call site,
  // and a measured zero then reads identically to 'we never counted'.
  const stats: { label: string; value: number | null; pane: Pane | null }[] = [
    { label: p.tab_techniques, value: techniques.length, pane: 'techniques' },
    { label: p.tab_applications, value: subject.applications.length, pane: 'applications' },
    { label: p.evidence_heading, value: subject.evidence.length, pane: 'evidence' },
    { label: p.deviations_heading, value: subject.deviations.length, pane: 'evidence' },
  ];

  return (
    <>
      {/* Header band with the stat figures */}
      <div className="rounded-card border border-border/50 bg-secondary/15 px-5 py-4 mb-5">
        <div className="flex items-center gap-2.5 flex-wrap mb-1">
          <h1 className="typo-section-title text-foreground">{subject.title}</h1>
          <HierarchyStatusChip status={subject.status} />
        </div>
        {subject.summary && (
          <p className="text-base text-foreground leading-relaxed mb-3">{subject.summary}</p>
        )}
        <div className="flex gap-6 flex-wrap">
          {stats.map((stat) => (
            <button
              key={stat.label}
              type="button"
              onClick={() => stat.pane && setPane(stat.pane)}
              className="text-left group/stat"
            >
              <span className={`block typo-data-lg tabular-nums ${stat.label === p.deviations_heading && (stat.value ?? 0) > 0 ? 'text-status-warning' : 'text-foreground'}`}>
                {stat.value ?? '—'}
              </span>
              {/* muted-ok: stat figure label, structural chrome */}
              <span className="block typo-caption uppercase tracking-wide text-foreground/50 group-hover/stat:text-foreground/80 transition-colors">
                {stat.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Underline pane nav */}
      <div className="flex gap-5 border-b border-border/50 mb-5" role="tablist" aria-label={p.detail_tabs_aria}>
        {([
          ['golden_path', p.tab_golden_path],
          ['techniques', `${p.tab_techniques}`],
          ['applications', `${p.tab_applications}`],
          ['evidence', p.tab_evidence],
        ] as [Pane, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pane === id}
            onClick={() => setPane(id)}
            className={`typo-body pb-2 -mb-px border-b-2 transition-colors ${
              pane === id
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-foreground/60 hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pb-10">
        {pane === 'golden_path' && (
          <div className="max-w-[72ch]">
            <InlineDocBody projectId={projectId} relPath={subject.file} onLinkClick={(href) => onLinkHref(subject.file, href)} />
          </div>
        )}

        {pane === 'techniques' && (
          <div className="space-y-2.5">
            {techniques.length === 0 && <p className="typo-body text-foreground">{p.techniques_empty}</p>}
            {techniques.map(({ tech, owner }) => {
              const expanded = openTech === tech.slug;
              return (
                <div key={`${tech.subject}/${tech.slug}`} className="rounded-card border border-border/50 bg-secondary/20 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenTech(expanded ? null : tech.slug)}
                    aria-expanded={expanded}
                    className="w-full text-left px-4 py-3 hover:bg-secondary/40 transition-colors"
                  >
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="typo-body text-foreground">{tech.title}</span>
                      {owner && (
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); onSelect(owner); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect(owner); }
                          }}
                          className="typo-caption font-mono rounded-interactive border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                        >
                          {`@${owner}`}
                        </span>
                      )}
                      <LawChips laws={tech.laws} graph={graph} onOpenLaw={onOpenLaw} />
                    </span>
                    {tech.summary && (
                      <span className="block typo-body text-foreground/75 mt-1 leading-relaxed">{tech.summary}</span>
                    )}
                  </button>
                  {expanded && (
                    <div className="border-t border-border/40 px-4 py-3.5 bg-background/40 max-w-[72ch]">
                      <InlineDocBody projectId={projectId} relPath={tech.file} onLinkClick={(href) => onLinkHref(tech.file, href)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pane === 'applications' && (
          <div className="space-y-2">
            {subject.applications.length === 0 && <p className="typo-body text-foreground">{p.applications_empty}</p>}
            {subject.applications.map((app) => {
              const expanded = openApp === app.file;
              const name = (app.file.split('/').pop() ?? app.file).replace(/\.md$/, '');
              return (
                <div key={app.file} className="rounded-card border border-border/50 bg-secondary/20 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenApp(expanded ? null : app.file)}
                    aria-expanded={expanded}
                    className="w-full flex items-center gap-2.5 text-left px-4 py-2.5 hover:bg-secondary/40 transition-colors"
                  >
                    <span className={`typo-caption font-mono rounded-interactive border px-1.5 py-0.5 flex-shrink-0 ${STACK_CLASSES[app.stack] ?? STACK_FALLBACK}`}>
                      {app.stack}
                    </span>
                    <span className="typo-body text-foreground truncate flex-1">{name}</span>
                    {/* muted-ok: technique slug micro-label */}
                    <span className="typo-caption text-foreground/50 font-mono truncate">{app.technique}</span>
                  </button>
                  {expanded && (
                    <div className="border-t border-border/40 px-4 py-3.5 bg-background/40 max-w-[72ch]">
                      <InlineDocBody projectId={projectId} relPath={app.file} onLinkClick={(href) => onLinkHref(app.file, href)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pane === 'evidence' && (
          <div className="space-y-5 max-w-[80ch]">
            <section>
              {/* muted-ok: section band header */}
              <h3 className="typo-label uppercase tracking-wide text-foreground/50 mb-2">{p.evidence_heading}</h3>
              {subject.evidence.length === 0 && <p className="typo-body text-foreground">{p.evidence_empty}</p>}
              <ul className="space-y-1">
                {subject.evidence.map((path) => (
                  <li key={path} className="rounded-interactive bg-secondary/20 px-2.5 py-1.5">
                    <code className="typo-code text-foreground">{path}</code>
                  </li>
                ))}
              </ul>
            </section>
            {subject.counterEvidence.length > 0 && (
              <section>
                <h3 className="typo-label uppercase tracking-wide text-status-warning mb-2">{p.counter_evidence_heading}</h3>
                <ul className="space-y-1">
                  {subject.counterEvidence.map((path) => (
                    <li key={path} className="rounded-interactive border border-status-warning/25 bg-status-warning/5 px-2.5 py-1.5">
                      <code className="typo-code text-status-warning/90">{path}</code>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {subject.deviations.length > 0 && (
              <section>
                <h3 className="typo-label uppercase tracking-wide text-foreground/50 mb-2">{p.deviations_heading}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {subject.deviations.map((anchor) => (
                    <button
                      key={anchor}
                      type="button"
                      onClick={() => onOpenDoc('docs/concepts/golden-path-deferred-fixes.md', anchor)}
                      className="typo-caption font-mono rounded-interactive border border-status-warning/30 bg-status-warning/10 px-2 py-1 text-status-warning hover:bg-status-warning/20 transition-colors"
                    >
                      {anchor}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

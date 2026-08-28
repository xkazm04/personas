// VARIANT: Console — the subject as an engineering dossier / spec sheet.
//
// Metaphor: a technical print. Three tight panes: a vertical category strip
// (icon + count), a dense monospace-accented subject list, and a dossier whose
// header is a key-value SPEC GRID (status · category · counts · census) and
// whose body is numbered, rule-separated sections read in one scroll. Where
// the Codex is warm prose, the Console is cold structure — readability through
// alignment, tabular numerals and hairlines instead of atmosphere.
/* eslint-disable custom/no-hardcoded-jsx-text -- prototype-only labels; the
   winner's strings are extracted to i18n at consolidation */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
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

/** Labeled hairline rule that opens each dossier section. */
function SectionRule({ index, label, count }: { index: number; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-3 mt-10 mb-4 first:mt-0">
      {/* muted-ok: section numeral + label, structural chrome */}
      <span className="typo-caption font-mono text-primary/70 tabular-nums">
        {String(index).padStart(2, '0')}
      </span>
      <h2 className="typo-label uppercase tracking-widest text-foreground/70 whitespace-nowrap">
        {label}
        {typeof count === 'number' && (
          <span className="text-foreground/40 ml-1.5 tabular-nums normal-case tracking-normal">{count}</span>
        )}
      </h2>
      <div className="h-px flex-1 bg-border/50" aria-hidden />
    </div>
  );
}

export function SubjectsConsole(props: SubjectsVariantProps) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;
  const {
    projectId, graph, groups, selectedSlug, onSelect, matchMap,
    adherence, focus, onLinkHref, onOpenDoc, onOpenLaw,
  } = props;

  const [categoryId, setCategoryId] = useState<string | null>(groups[0]?.id ?? null);
  const [openTech, setOpenTech] = useState<string | null>(null);
  const [openApp, setOpenApp] = useState<string | null>(null);

  const subject = useMemo(
    () => graph.subjects.find((s) => s.slug === selectedSlug) ?? null,
    [graph.subjects, selectedSlug],
  );

  // Selection made elsewhere (cross-link) re-anchors the category strip.
  useEffect(() => {
    if (subject && subject.category !== categoryId) setCategoryId(subject.category ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-anchor only on subject change
  }, [subject?.slug]);

  useEffect(() => {
    setOpenTech(null);
    setOpenApp(null);
  }, [selectedSlug]);

  useEffect(() => {
    if (!focus) return;
    const id = focus.kind === 'technique' ? `console-t-${focus.technique}` : 'console-sec-applications';
    if (focus.kind === 'technique') setOpenTech(focus.technique);
    else setOpenApp(focus.file);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [focus]);

  const visibleGroups = visibleGroupsOf(groups, matchMap);
  const searching = matchMap !== null;

  const listGroup = searching
    ? { subjects: visibleGroups.flatMap((g) => g.subjects) }
    : groups.find((g) => g.id === categoryId) ?? { subjects: [] };

  const techniques = useMemo(() => {
    if (!subject) return [];
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

  const score = subject ? adherence?.get(subject.slug) ?? null : null;
  const categoryTitle = graph.categories.find((c) => c.id === subject?.category)?.title ?? '—';

  return (
    <div className="flex-1 min-h-0 flex rounded-card border border-border/40 bg-background/40 overflow-hidden animate-fade-in">
      {/* ── Category strip ─────────────────────────────────────────────── */}
      {!searching && (
        <nav className="w-[184px] flex-shrink-0 border-r border-border/40 overflow-y-auto py-2" aria-label={p.lane_subjects}>
          {groups.map((g) => {
            const Icon = categoryIcon(g.id);
            const active = g.id === categoryId;
            return (
              <button
                key={g.id ?? '__unassigned'}
                type="button"
                onClick={() => setCategoryId(g.id)}
                aria-pressed={active}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-l-2 ${
                  active
                    ? 'border-primary bg-primary/8 text-foreground'
                    : 'border-transparent text-foreground/65 hover:text-foreground hover:bg-secondary/40'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-primary' : 'text-foreground/45'}`} aria-hidden />
                <span className="typo-caption font-medium flex-1 truncate leading-tight">
                  {g.id === null ? p.category_unassigned : g.title}
                </span>
                {/* muted-ok: strip count micro-label */}
                <span className="typo-caption text-foreground/35 tabular-nums">{g.subjects.length}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* ── Subject list ───────────────────────────────────────────────── */}
      <nav className="w-[248px] flex-shrink-0 border-r border-border/40 overflow-y-auto py-1.5" aria-label={p.detail_tabs_aria}>
        {listGroup.subjects.length === 0 && (
          <p className="typo-body text-foreground p-4">{p.search_no_matches}</p>
        )}
        {listGroup.subjects.map((s) => {
          const active = s.slug === selectedSlug;
          const rowScore = adherence?.get(s.slug);
          return (
            <button
              key={s.slug}
              type="button"
              onClick={() => onSelect(s.slug)}
              aria-current={active ? 'true' : undefined}
              className={`w-full text-left px-3 py-[7px] transition-colors group/row ${
                active ? 'bg-primary/10' : 'hover:bg-secondary/40'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <ChevronRight
                  className={`w-3 h-3 flex-shrink-0 transition-opacity ${active ? 'text-primary opacity-100' : 'opacity-0 group-hover/row:opacity-40'}`}
                  aria-hidden
                />
                <span className={`typo-body font-mono truncate flex-1 ${active ? 'text-foreground font-medium' : 'text-foreground/80'}`}>
                  {s.slug}
                </span>
                {s.deviations.length > 0 && (
                  <AlertTriangle className="w-3 h-3 text-status-warning flex-shrink-0" aria-hidden />
                )}
                {/* muted-ok: T/A counts, structural micro-label */}
                <span className="typo-caption text-foreground/40 tabular-nums font-mono flex-shrink-0">
                  {s.techniques.length + s.sharedTechniques.length}·{s.applications.length}
                  {rowScore && rowScore.sites > 0 ? `·${rowScore.sites}` : ''}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* ── Dossier ────────────────────────────────────────────────────── */}
      {subject ? (
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[860px] px-7 py-6">
            {/* Spec-grid header */}
            <div className="mb-2 flex items-center gap-2.5">
              <h1 className="typo-section-title text-foreground">{subject.title}</h1>
              {/* muted-ok: slug echo, structural chrome */}
              <code className="typo-caption font-mono text-foreground/40">{subject.slug}</code>
            </div>
            {subject.summary && (
              <p className="text-base text-foreground leading-relaxed max-w-[72ch] mb-4">{subject.summary}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border border-border/50 rounded-card overflow-hidden mb-2 bg-secondary/10">
              {[
                { label: 'Status', node: <HierarchyStatusChip status={subject.status} /> },
                { label: 'Category', node: <span className="typo-body text-foreground truncate block">{categoryTitle}</span> },
                { label: p.tab_techniques, node: <span className="typo-data-lg text-foreground tabular-nums">{techniques.length}</span> },
                { label: p.tab_applications, node: <span className="typo-data-lg text-foreground tabular-nums">{subject.applications.length}</span> },
                { label: p.evidence_heading, node: <span className="typo-data-lg text-foreground tabular-nums">{subject.evidence.length}</span> },
                {
                  label: p.deviations_heading,
                  node: (
                    <span className={`typo-data-lg tabular-nums ${subject.deviations.length > 0 ? 'text-status-warning' : 'text-foreground/50'}`}>
                      {subject.deviations.length}
                    </span>
                  ),
                },
              ].map((cell) => (
                <div key={cell.label} className="px-3 py-2 border-r border-b sm:border-b-0 border-border/40 last:border-r-0">
                  {/* muted-ok: spec-grid key, structural chrome */}
                  <span className="block typo-caption uppercase tracking-wide text-foreground/45 mb-0.5">{cell.label}</span>
                  {cell.node}
                </div>
              ))}
            </div>
            {score && (
              // muted-ok: census predicate line, structural provenance
              <p className="typo-caption text-foreground/50 mb-6">
                {tx(p.adherence_predicate, {
                  clean: score.cleanContexts,
                  applicable: score.applicableContexts,
                  sites: score.sites,
                })}
              </p>
            )}

            {/* 01 — golden path */}
            <SectionRule index={1} label={p.tab_golden_path} />
            <div className="max-w-[72ch]">
              <InlineDocBody projectId={projectId} relPath={subject.file} onLinkClick={(href) => onLinkHref(subject.file, href)} />
            </div>

            {/* 02 — techniques */}
            <SectionRule index={2} label={p.tab_techniques} count={techniques.length} />
            {techniques.length === 0 && <p className="typo-body text-foreground">{p.techniques_empty}</p>}
            <div>
              {techniques.map(({ tech, owner }, i) => {
                const expanded = openTech === tech.slug;
                return (
                  <div key={`${tech.subject}/${tech.slug}`} id={`console-t-${tech.slug}`} className="border-b border-border/30 last:border-b-0 scroll-mt-4">
                    <button
                      type="button"
                      onClick={() => setOpenTech(expanded ? null : tech.slug)}
                      aria-expanded={expanded}
                      className="w-full text-left py-2.5 hover:bg-secondary/20 transition-colors px-2 -mx-2 rounded-interactive"
                    >
                      <span className="flex items-center gap-2.5 flex-wrap">
                        {/* muted-ok: row numeral, structural ornament */}
                        <span className="typo-caption font-mono text-foreground/35 tabular-nums w-5">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="typo-body font-medium text-foreground">{tech.title}</span>
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
                        <span className="ml-auto flex items-center gap-1.5">
                          <LawChips laws={tech.laws} graph={graph} onOpenLaw={onOpenLaw} />
                        </span>
                      </span>
                      {tech.summary && (
                        <span className="block typo-caption text-foreground/70 mt-1 ml-[30px] leading-relaxed max-w-[70ch]">
                          {tech.summary}
                        </span>
                      )}
                    </button>
                    {expanded && (
                      <div className="ml-[30px] mb-3 pl-3 border-l-2 border-primary/25 max-w-[70ch]">
                        <InlineDocBody projectId={projectId} relPath={tech.file} onLinkClick={(href) => onLinkHref(tech.file, href)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 03 — applications */}
            <div id="console-sec-applications" className="scroll-mt-4">
              <SectionRule index={3} label={p.tab_applications} count={subject.applications.length} />
            </div>
            {subject.applications.length === 0 && <p className="typo-body text-foreground">{p.applications_empty}</p>}
            <div>
              {subject.applications.map((app) => {
                const expanded = openApp === app.file;
                const name = (app.file.split('/').pop() ?? app.file).replace(/\.md$/, '');
                return (
                  <div key={app.file} className="border-b border-border/30 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setOpenApp(expanded ? null : app.file)}
                      aria-expanded={expanded}
                      className="w-full flex items-center gap-2.5 text-left py-2 hover:bg-secondary/20 transition-colors px-2 -mx-2 rounded-interactive"
                    >
                      <span className={`typo-caption font-mono rounded-interactive border px-1.5 py-0.5 flex-shrink-0 w-16 text-center ${STACK_CLASSES[app.stack] ?? STACK_FALLBACK}`}>
                        {app.stack}
                      </span>
                      <span className="typo-body font-mono text-foreground truncate flex-1">{name}</span>
                      {/* muted-ok: technique slug micro-label */}
                      <span className="typo-caption text-foreground/45 font-mono truncate">{app.technique}</span>
                    </button>
                    {expanded && (
                      <div className="mb-3 pl-3 border-l-2 border-primary/25 max-w-[70ch]">
                        <InlineDocBody projectId={projectId} relPath={app.file} onLinkClick={(href) => onLinkHref(app.file, href)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 04 — evidence + deviations */}
            <SectionRule index={4} label={p.tab_evidence} count={subject.evidence.length + subject.counterEvidence.length} />
            {subject.evidence.length === 0 && <p className="typo-body text-foreground">{p.evidence_empty}</p>}
            <ul className="space-y-0.5 mb-4">
              {subject.evidence.map((path) => (
                <li key={path} className="typo-code font-mono text-foreground/85 px-2 py-1 rounded-interactive hover:bg-secondary/30 truncate">
                  {path}
                </li>
              ))}
              {subject.counterEvidence.map((path) => (
                <li key={path} className="typo-code font-mono text-status-warning/90 px-2 py-1 rounded-interactive hover:bg-status-warning/10 truncate">
                  {path}
                </li>
              ))}
            </ul>
            {subject.deviations.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-10">
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
            )}
            <div className="pb-8" />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0 flex items-center justify-center">
          <p className="typo-body text-foreground">{p.select_subject_hint}</p>
        </div>
      )}
    </div>
  );
}

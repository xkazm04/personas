// Subjects lane body — the subject as a single, beautifully typeset document
// (the "Codex" direction, promoted 2026-08-26 over Baseline / Atlas / Console).
//
// Metaphor: a reading room. One coherent piece of doctrine is laid out as ONE
// continuous scroll with a measured line length (~72ch),
// chapter-numbered techniques, and an appendix — because the corpus IS prose,
// and prose is read top-to-bottom, not tab-by-tab. A sticky Contents rail on
// the right gives the map; a slim category spine on the left gives the shelf.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';

import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
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

export function SubjectsCodex(props: SubjectsVariantProps) {
  const { t } = useTranslation();
  const p = t.overview.patterns_v2;
  const {
    projectId, graph, groups, selectedSlug, onSelect, matchMap,
    focus, onLinkHref, onOpenDoc, onOpenLaw,
  } = props;

  const subject = useMemo(
    () => graph.subjects.find((s) => s.slug === selectedSlug) ?? null,
    [graph.subjects, selectedSlug],
  );
  const categoryTitle = useMemo(
    () => graph.categories.find((c) => c.id === subject?.category)?.title ?? null,
    [graph.categories, subject?.category],
  );

  const techniques = useMemo(() => {
    if (!subject) return [];
    const local = graph.techniques
      .filter((tech) => tech.subject === subject.slug)
      .map((tech) => ({ tech, owner: null as string | null }));
    const shared = subject.sharedTechniques
      .map((ref) => {
        const tech = graph.techniques.find(
          (c) => c.subject === ref.owner && c.slug === ref.technique,
        );
        return tech ? { tech, owner: ref.owner } : null;
      })
      .filter((x): x is { tech: HierarchyTechnique; owner: string } => x !== null);
    return [...local, ...shared];
  }, [graph.techniques, subject]);

  const legacyEntries = useMemo(
    () => (subject ? graph.corpusMap.filter((e) => e.subject === subject.slug) : []),
    [graph.corpusMap, subject],
  );

  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Fresh subject → close chapters, scroll to top.
  useEffect(() => {
    setOpenChapter(null);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selectedSlug]);

  // Cross-link focus: open + scroll to the target chapter / application.
  useEffect(() => {
    if (!focus) return;
    const id = focus.kind === 'technique' ? `codex-ch-${focus.technique}` : 'codex-applications';
    if (focus.kind === 'technique') setOpenChapter(focus.technique);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [focus]);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const visibleGroups = visibleGroupsOf(groups, matchMap);

  return (
    <div className="flex-1 min-h-0 flex rounded-card border border-border/40 bg-background/40 overflow-hidden animate-fade-in">
      {/* ── The shelf: slim category spine ─────────────────────────────── */}
      <nav className="w-[248px] flex-shrink-0 border-r border-border/40 overflow-y-auto py-2" aria-label={p.lane_subjects}>
        {visibleGroups.length === 0 && matchMap && (
          <p className="typo-body text-foreground p-4">{p.search_no_matches}</p>
        )}
        {visibleGroups.map((group) => {
          const Icon = categoryIcon(group.id);
          const holdsSelection = group.subjects.some((s) => s.slug === selectedSlug);
          return (
            <details key={group.id ?? '__unassigned'} open={holdsSelection || matchMap !== null} className="group/cat">
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none hover:bg-secondary/40 transition-colors">
                {/* muted-ok: decorative category glyph */}
                <Icon className="w-3.5 h-3.5 text-foreground/45 flex-shrink-0" aria-hidden />
                <span className="typo-label uppercase tracking-wide text-foreground/60 flex-1 truncate">
                  {group.id === null ? p.category_unassigned : group.title}
                </span>
                {/* muted-ok: shelf count micro-label */}
                <span className="typo-caption text-foreground/35 tabular-nums">{group.subjects.length}</span>
                <ChevronDown
                  className="w-3 h-3 text-foreground/35 transition-transform group-open/cat:rotate-180"
                  aria-hidden
                />
              </summary>
              <ul className="pb-1.5">
                {group.subjects.map((s) => {
                  const active = s.slug === selectedSlug;
                  return (
                    <li key={s.slug}>
                      <button
                        type="button"
                        onClick={() => onSelect(s.slug)}
                        aria-current={active ? 'true' : undefined}
                        className={`w-full text-left pl-9 pr-3 py-1.5 typo-body truncate transition-colors border-l-2 ${
                          active
                            ? 'border-primary text-foreground bg-primary/8 font-medium'
                            : 'border-transparent text-foreground/70 hover:text-foreground hover:bg-secondary/40'
                        }`}
                      >
                        {s.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </nav>

      {/* ── The page ───────────────────────────────────────────────────── */}
      {subject ? (
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto">
          <div className="flex gap-8 px-8 py-8 max-w-[1100px] mx-auto">
            <article className="flex-1 min-w-0 max-w-[72ch]">
              {/* Kicker + title + lede */}
              <div className="flex items-center gap-2 mb-2">
                {/* muted-ok: kicker line, structural chrome */}
                <span className="typo-label uppercase tracking-widest text-primary/80">{categoryTitle}</span>
                <HierarchyStatusChip status={subject.status} />
              </div>
              <h1 className="typo-hero text-foreground mb-3">{subject.title}</h1>
              {subject.summary && (
                <p className="text-base text-foreground font-medium leading-relaxed border-l-2 border-primary/40 pl-4 mb-8">
                  {subject.summary}
                </p>
              )}

              {/* The golden path itself */}
              <section id="codex-golden-path">
                <InlineDocBody
                  projectId={projectId}
                  relPath={subject.file}
                  onLinkClick={(href) => onLinkHref(subject.file, href)}
                />
              </section>

              {/* Chapters — the techniques */}
              {techniques.length > 0 && (
                <section id="codex-techniques" className="mt-10">
                  <h2 className="typo-section-title text-foreground border-b border-border/50 pb-2 mb-4">
                    {p.tab_techniques}
                  </h2>
                  <div className="space-y-4">
                    {techniques.map(({ tech, owner }, i) => {
                      const open = openChapter === tech.slug;
                      return (
                        <div key={`${tech.subject}/${tech.slug}`} id={`codex-ch-${tech.slug}`} className="scroll-mt-4">
                          <button
                            type="button"
                            onClick={() => setOpenChapter(open ? null : tech.slug)}
                            aria-expanded={open}
                            className="w-full text-left group/ch"
                          >
                            <span className="flex items-baseline gap-3">
                              {/* muted-ok: chapter numeral, structural ornament */}
                              <span className="typo-data-lg text-foreground/25 tabular-nums leading-none">
                                {String(i + 1).padStart(2, '0')}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="flex items-center gap-2 flex-wrap">
                                  <span className="text-base font-semibold text-foreground group-hover/ch:text-primary transition-colors">
                                    {tech.title}
                                  </span>
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
                                  <ChevronDown
                                    className={`w-3.5 h-3.5 text-foreground/40 transition-transform ${open ? 'rotate-180' : ''}`}
                                    aria-hidden
                                  />
                                </span>
                                {tech.summary && (
                                  <span className="block typo-body text-foreground/80 mt-1 leading-relaxed">
                                    {tech.summary}
                                  </span>
                                )}
                              </span>
                            </span>
                          </button>
                          {open && (
                            <div className="mt-3 ml-10 pl-4 border-l border-border/50">
                              <InlineDocBody
                                projectId={projectId}
                                relPath={tech.file}
                                onLinkClick={(href) => onLinkHref(tech.file, href)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Applications — worked examples */}
              {subject.applications.length > 0 && (
                <section id="codex-applications" className="mt-10 scroll-mt-4">
                  <h2 className="typo-section-title text-foreground border-b border-border/50 pb-2 mb-4">
                    {p.tab_applications}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {subject.applications.map((app) => {
                      const name = (app.file.split('/').pop() ?? app.file).replace(/\.md$/, '');
                      return (
                        <button
                          key={app.file}
                          type="button"
                          onClick={() => onOpenDoc(app.file, null)}
                          className="text-left rounded-card border border-border/50 bg-secondary/20 px-3.5 py-3 hover:border-primary/40 hover:bg-secondary/30 transition-colors"
                        >
                          <span className="flex items-center gap-2 mb-1">
                            <span className={`typo-caption font-mono rounded-interactive border px-1.5 py-0.5 ${STACK_CLASSES[app.stack] ?? STACK_FALLBACK}`}>
                              {app.stack}
                            </span>
                            {/* muted-ok: technique slug micro-label */}
                            <span className="typo-caption text-foreground/50 font-mono truncate">{app.technique}</span>
                          </span>
                          <span className="typo-body font-medium text-foreground block truncate">{name}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Appendix — evidence + deviations + legacy */}
              <section id="codex-appendix" className="mt-10 mb-16 scroll-mt-4">
                <h2 className="typo-section-title text-foreground border-b border-border/50 pb-2 mb-4">
                  {p.tab_evidence}
                </h2>
                {subject.evidence.length === 0 ? (
                  <p className="typo-body text-foreground">{p.evidence_empty}</p>
                ) : (
                  <ul className="space-y-1 mb-5">
                    {subject.evidence.map((path) => (
                      <li key={path} className="flex items-center gap-2 rounded-interactive bg-secondary/20 px-2.5 py-1.5">
                        <code className="typo-code text-foreground truncate flex-1">{path}</code>
                        <CopyButton text={path} tooltip={t.common.copy} />
                      </li>
                    ))}
                  </ul>
                )}
                {subject.deviations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-5">
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
                {legacyEntries.length > 0 && (
                  <div className="space-y-1">
                    {legacyEntries.map((entry) => (
                      <button
                        key={entry.legacyFile}
                        type="button"
                        onClick={() => onOpenDoc(`docs/concepts/golden-paths/${entry.legacyFile}`, null)}
                        className="w-full flex items-center gap-2 text-left rounded-interactive px-2.5 py-1.5 hover:bg-secondary/30 transition-colors"
                      >
                        {/* muted-ok: decorative row glyph */}
                        <ExternalLink className="w-3.5 h-3.5 text-foreground/40 flex-shrink-0" aria-hidden />
                        <code className="typo-code text-foreground/70 truncate">{entry.legacyFile}</code>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </article>

            {/* ── Contents rail (sticky) ─────────────────────────────────── */}
            <aside className="hidden xl:block w-[200px] flex-shrink-0">
              <div className="sticky top-0 pt-1">
                <h3 className="typo-label uppercase tracking-wide text-foreground/50 mb-2">{p.codex_contents}</h3>
                <ul className="space-y-1 border-l border-border/50">
                  <li>
                    <button type="button" onClick={() => jump('codex-golden-path')} className="w-full text-left typo-body text-foreground/70 hover:text-foreground pl-3 py-0.5 border-l-2 border-transparent hover:border-primary/50 -ml-px transition-colors">
                      {p.tab_golden_path}
                    </button>
                  </li>
                  {techniques.map(({ tech }, i) => (
                    <li key={tech.slug}>
                      <button
                        type="button"
                        onClick={() => { setOpenChapter(tech.slug); jump(`codex-ch-${tech.slug}`); }}
                        className="w-full text-left typo-caption text-foreground/60 hover:text-foreground pl-3 py-0.5 border-l-2 border-transparent hover:border-primary/50 -ml-px transition-colors truncate"
                      >
                        <span className="tabular-nums text-foreground/35">{String(i + 1).padStart(2, '0')}</span>{' '}
                        {tech.title}
                      </button>
                    </li>
                  ))}
                  {subject.applications.length > 0 && (
                    <li>
                      <button type="button" onClick={() => jump('codex-applications')} className="w-full text-left typo-body text-foreground/70 hover:text-foreground pl-3 py-0.5 border-l-2 border-transparent hover:border-primary/50 -ml-px transition-colors">
                        {p.tab_applications}{' '}
                        <span className="typo-caption text-foreground/40 tabular-nums">{subject.applications.length}</span>
                      </button>
                    </li>
                  )}
                  <li>
                    <button type="button" onClick={() => jump('codex-appendix')} className="w-full text-left typo-body text-foreground/70 hover:text-foreground pl-3 py-0.5 border-l-2 border-transparent hover:border-primary/50 -ml-px transition-colors">
                      {p.tab_evidence}
                    </button>
                  </li>
                </ul>
              </div>
            </aside>
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

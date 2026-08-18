// Right pane of the Subjects master–detail: header + five tabs over one
// subject. Doc bodies are lazily fetched per file (the graph carries paths,
// never bodies); relative links inside any body route through the parent's
// resolveDocLink interception, so a golden path can navigate the rail.
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';

import { getHierarchyDoc } from '@/api/devTools/hierarchy';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import type { HierarchyDoc } from '@/lib/bindings/HierarchyDoc';
import type { HierarchyGraph } from '@/lib/bindings/HierarchyGraph';
import type { HierarchySubject } from '@/lib/bindings/HierarchySubject';
import type { HierarchyTechnique } from '@/lib/bindings/HierarchyTechnique';
import { silentCatch } from '@/lib/silentCatch';

import { HierarchyStatusChip } from './HierarchyStatusChip';

export type DetailTab = 'golden_path' | 'techniques' | 'applications' | 'evidence' | 'legacy';

/** A navigation nudge from a resolved cross-link: open this tab and expand
 *  this entry. A fresh object identity per navigation re-triggers the effect. */
export type DetailFocus =
  | { kind: 'technique'; technique: string }
  | { kind: 'application'; file: string };

/** Semantic stack-badge tones — tokens only, one small map, neutral fallback. */
const STACK_CLASSES: Record<string, string> = {
  react: 'border-status-info/30 bg-status-info/10 text-status-info',
  rust: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  sql: 'border-primary/30 bg-primary/10 text-primary',
  node: 'border-status-success/30 bg-status-success/10 text-status-success',
  process: 'border-border/60 bg-secondary/50 text-foreground/60',
};
const STACK_FALLBACK = 'border-border/60 bg-secondary/50 text-foreground/60';

/** Calm ghost for an in-flight doc body. */
function BodyGhost() {
  return (
    <div aria-hidden="true" className="space-y-3 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[95, 100, 82, 70].map((w, i) => (
        <div key={i} className="h-3.5 rounded-interactive bg-secondary/50" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** Lazily fetched markdown body for one repo-relative file. */
function InlineDocBody({
  projectId,
  relPath,
  onLinkClick,
}: {
  projectId: string;
  relPath: string;
  onLinkClick: (href: string) => boolean;
}) {
  const { t } = useTranslation();
  const p = t.overview.patterns_v2;
  const [doc, setDoc] = useState<HierarchyDoc | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setDoc(null);
    setFailed(false);
    getHierarchyDoc(projectId, relPath)
      .then((d) => { if (live) setDoc(d); })
      .catch((err) => {
        silentCatch('patterns:hierarchyInlineDoc')(err);
        if (live) setFailed(true);
      });
    return () => { live = false; };
  }, [projectId, relPath]);

  if (failed) return <p className="typo-body text-status-warning">{p.doc_load_failed}</p>;
  if (doc === null) return <BodyGhost />;
  if (!doc.exists) return <p className="typo-body text-foreground">{p.doc_missing}</p>;
  return <MarkdownRenderer content={doc.markdown} className="leading-relaxed" onLinkClick={onLinkClick} />;
}

function LawChips({
  laws,
  graph,
  onOpenLaw,
}: {
  laws: string[];
  graph: HierarchyGraph;
  onOpenLaw: (lawId: string) => void;
}) {
  if (laws.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {laws.map((id) => {
        const law = graph.laws.find((l) => l.id === id);
        const chip = (
          <button
            key={id}
            type="button"
            onClick={() => onOpenLaw(id)}
            className="typo-caption font-mono rounded-interactive border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-accent hover:bg-accent/20 transition-colors"
          >
            {id}
          </button>
        );
        return law ? (
          <Tooltip key={id} content={law.summary || law.title}>
            {chip}
          </Tooltip>
        ) : (
          chip
        );
      })}
    </span>
  );
}

export function SubjectDetail({
  projectId,
  graph,
  subject,
  focus,
  onLinkHref,
  onSelectSubject,
  onOpenDoc,
  onOpenLaw,
}: {
  projectId: string;
  graph: HierarchyGraph;
  subject: HierarchySubject;
  /** Cross-link navigation nudge (open tab + expand entry). */
  focus: DetailFocus | null;
  /** Intercepted markdown link: parent resolves + routes. `currentFile` is the
   *  doc the click happened inside — the base for relative resolution. */
  onLinkHref: (currentFile: string, href: string) => boolean;
  onSelectSubject: (slug: string) => void;
  /** Open a plain doc overlay (deviations, legacy, misc. concept docs). */
  onOpenDoc: (file: string, anchor: string | null) => void;
  onOpenLaw: (lawId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;

  const [tab, setTab] = useState<DetailTab>(
    focus?.kind === 'technique' ? 'techniques' : focus?.kind === 'application' ? 'applications' : 'golden_path',
  );
  const [expandedTechnique, setExpandedTechnique] = useState<string | null>(
    focus?.kind === 'technique' ? focus.technique : null,
  );
  const [expandedApp, setExpandedApp] = useState<string | null>(
    focus?.kind === 'application' ? focus.file : null,
  );

  // A later cross-link into this already-mounted subject re-focuses it.
  useEffect(() => {
    if (!focus) return;
    if (focus.kind === 'technique') {
      setTab('techniques');
      setExpandedTechnique(focus.technique);
    } else {
      setTab('applications');
      setExpandedApp(focus.file);
    }
  }, [focus]);

  const categoryTitle = useMemo(
    () => graph.categories.find((c) => c.id === subject.category)?.title ?? null,
    [graph.categories, subject.category],
  );

  // Local techniques + shared ones resolved to their owner's canonical row.
  const techniques = useMemo(() => {
    const local = graph.techniques
      .filter((tech) => tech.subject === subject.slug)
      .map((tech) => ({ tech, owner: null as string | null }));
    const shared = subject.sharedTechniques
      .map((ref) => {
        const tech = graph.techniques.find(
          (candidate) => candidate.subject === ref.owner && candidate.slug === ref.technique,
        );
        return tech ? { tech, owner: ref.owner } : null;
      })
      .filter((x): x is { tech: HierarchyTechnique; owner: string } => x !== null);
    return [...local, ...shared];
  }, [graph.techniques, subject]);

  const legacyEntries = useMemo(
    () => graph.corpusMap.filter((e) => e.subject === subject.slug),
    [graph.corpusMap, subject.slug],
  );

  const tabs = useMemo(() => {
    const base: { id: DetailTab; label: string }[] = [
      { id: 'golden_path' as const, label: p.tab_golden_path },
      { id: 'techniques' as const, label: `${p.tab_techniques} (${techniques.length})` },
      { id: 'applications' as const, label: `${p.tab_applications} (${subject.applications.length})` },
      { id: 'evidence' as const, label: p.tab_evidence },
    ];
    if (legacyEntries.length > 0) {
      base.push({ id: 'legacy' as const, label: `${p.tab_legacy} (${legacyEntries.length})` });
    }
    return base;
  }, [p, techniques.length, subject.applications.length, legacyEntries.length]);

  // Legacy tab can vanish when switching to a subject without legacy docs.
  const effectiveTab = tab === 'legacy' && legacyEntries.length === 0 ? 'golden_path' : tab;

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-border/40">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="typo-section-title text-foreground">{subject.title}</h2>
          <HierarchyStatusChip status={subject.status} />
          {categoryTitle && (
            <>
              {/* muted-ok: category micro-label beside the title, structural chrome */}
              <span className="typo-caption text-foreground/50 uppercase tracking-wide">
                {categoryTitle}
              </span>
            </>
          )}
        </div>
        {subject.summary && (
          <p className="typo-body text-foreground mt-1.5 leading-relaxed">{subject.summary}</p>
        )}
        <div className="mt-3">
          <SegmentedTabs<DetailTab>
            tabs={tabs}
            activeTab={effectiveTab}
            onTabChange={setTab}
            ariaLabel={p.detail_tabs_aria}
            fullWidth={false}
            size="sm"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {effectiveTab === 'golden_path' && (
          <InlineDocBody
            projectId={projectId}
            relPath={subject.file}
            onLinkClick={(href) => onLinkHref(subject.file, href)}
          />
        )}

        {effectiveTab === 'techniques' && (
          <div className="space-y-2.5">
            {techniques.length === 0 && (
              <p className="typo-body text-foreground">{p.techniques_empty}</p>
            )}
            {techniques.map(({ tech, owner }) => {
              const key = `${tech.subject}/${tech.slug}`;
              const expanded = expandedTechnique === tech.slug;
              return (
                <div
                  key={key}
                  className="rounded-card border border-border/50 bg-secondary/20 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedTechnique(expanded ? null : tech.slug)}
                    aria-expanded={expanded}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-secondary/40 transition-colors"
                  >
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="typo-body font-medium text-foreground">{tech.title}</span>
                      {owner && (
                        <Tooltip content={tx(p.shared_from_tooltip, { owner })}>
                          <span
                            role="link"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectSubject(owner);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                onSelectSubject(owner);
                              }
                            }}
                            className="typo-caption font-mono rounded-interactive border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                          >
                            {`@${owner}`}
                          </span>
                        </Tooltip>
                      )}
                      <LawChips laws={tech.laws} graph={graph} onOpenLaw={onOpenLaw} />
                    </span>
                    {tech.summary && (
                      <span className="block typo-caption text-foreground mt-1 leading-relaxed">
                        {tech.summary}
                      </span>
                    )}
                  </button>
                  {expanded && (
                    <div className="border-t border-border/40 px-3.5 py-3 bg-background/40">
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
        )}

        {effectiveTab === 'applications' && (
          <div className="space-y-2">
            {subject.applications.length === 0 && (
              <p className="typo-body text-foreground">{p.applications_empty}</p>
            )}
            {subject.applications.map((app) => {
              const expanded = expandedApp === app.file;
              const name = app.file.split('/').pop() ?? app.file;
              return (
                <div
                  key={app.file}
                  className="rounded-card border border-border/50 bg-secondary/20 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedApp(expanded ? null : app.file)}
                    aria-expanded={expanded}
                    className="w-full flex items-center gap-2.5 text-left px-3.5 py-2 hover:bg-secondary/40 transition-colors"
                  >
                    <span
                      className={`typo-caption font-mono rounded-interactive border px-1.5 py-0.5 flex-shrink-0 ${STACK_CLASSES[app.stack] ?? STACK_FALLBACK}`}
                    >
                      {app.stack}
                    </span>
                    <span className="typo-body text-foreground truncate flex-1">{name}</span>
                    {/* muted-ok: technique slug micro-label, structural chrome */}
                    <span className="typo-caption text-foreground/50 font-mono truncate">
                      {app.technique}
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-border/40 px-3.5 py-3 bg-background/40">
                      <InlineDocBody
                        projectId={projectId}
                        relPath={app.file}
                        onLinkClick={(href) => onLinkHref(app.file, href)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {effectiveTab === 'evidence' && (
          <div className="space-y-5">
            <section>
              {/* muted-ok: section band header, structural chrome */}
              <h3 className="typo-label uppercase tracking-wide text-foreground/50 mb-2">
                {p.evidence_heading}
              </h3>
              {subject.evidence.length === 0 && (
                <p className="typo-body text-foreground">{p.evidence_empty}</p>
              )}
              <ul className="space-y-1">
                {subject.evidence.map((path) => (
                  <li
                    key={path}
                    className="flex items-center gap-2 rounded-interactive bg-secondary/20 px-2.5 py-1.5"
                  >
                    <code className="typo-code text-foreground truncate flex-1">{path}</code>
                    <CopyButton text={path} tooltip={t.common.copy} />
                  </li>
                ))}
              </ul>
            </section>

            {subject.counterEvidence.length > 0 && (
              <section>
                <h3 className="typo-label uppercase tracking-wide text-status-warning mb-2">
                  {p.counter_evidence_heading}
                </h3>
                <ul className="space-y-1">
                  {subject.counterEvidence.map((path) => (
                    <li
                      key={path}
                      className="flex items-center gap-2 rounded-interactive border border-status-warning/25 bg-status-warning/5 px-2.5 py-1.5"
                    >
                      <code className="typo-code text-status-warning/90 truncate flex-1">{path}</code>
                      <CopyButton text={path} tooltip={t.common.copy} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              {/* muted-ok: section band header, structural chrome */}
              <h3 className="typo-label uppercase tracking-wide text-foreground/50 mb-2">
                {p.deviations_heading}
              </h3>
              {subject.deviations.length === 0 && (
                <p className="typo-body text-foreground">{p.deviations_empty}</p>
              )}
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
          </div>
        )}

        {effectiveTab === 'legacy' && (
          <div className="space-y-1.5">
            {legacyEntries.map((entry) => (
              <button
                key={entry.legacyFile}
                type="button"
                onClick={() =>
                  onOpenDoc(`docs/concepts/golden-paths/${entry.legacyFile}`, null)
                }
                className="w-full flex items-center gap-2 text-left rounded-interactive bg-secondary/20 px-2.5 py-2 hover:bg-secondary/40 transition-colors"
              >
                {/* muted-ok: decorative row glyph, not text */}
                <ExternalLink className="w-3.5 h-3.5 text-foreground/40 flex-shrink-0" aria-hidden />
                <code className="typo-code text-foreground truncate">{entry.legacyFile}</code>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

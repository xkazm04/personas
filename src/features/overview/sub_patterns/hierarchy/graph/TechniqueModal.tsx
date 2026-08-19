// Technique detail modal for the hierarchy graph — clicking a technique node
// opens the doc here instead of leaving the sky (a camera flight under a full
// modal would never be seen). Body links route through the host's
// resolveDocLink interception so in-modal links navigate the graph focus;
// applications open the shared DocViewer; "Open in Subjects" jumps lanes.
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

import { getHierarchyDoc } from '@/api/devTools/hierarchy';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { HierarchyDoc } from '@/lib/bindings/HierarchyDoc';
import type { HierarchyGraph } from '@/lib/bindings/HierarchyGraph';
import { silentCatch } from '@/lib/silentCatch';
import { BaseModal } from '@/lib/ui/BaseModal';

import { HierarchyStatusChip } from '../HierarchyStatusChip';
import type { SubjectNode, TechniqueEntry } from './hierarchyGraphModel';
import { corpusRootFor } from '@/features/plugins/dev-tools/sub_workspaces/registry/useRegistryLibrary';

/** Semantic stack-badge tones — same small map as the Subjects lane. */
const STACK_CLASSES: Record<string, string> = {
  react: 'border-status-info/30 bg-status-info/10 text-status-info',
  rust: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  sql: 'border-primary/30 bg-primary/10 text-primary',
  node: 'border-status-success/30 bg-status-success/10 text-status-success',
  process: 'border-border/60 bg-secondary/50 text-foreground/60',
};
const STACK_FALLBACK = 'border-border/60 bg-secondary/50 text-foreground/60';

/** Calm geometry-matched ghost under the modal chrome while the doc loads. */
function BodyGhost() {
  return (
    <div aria-hidden="true" className="space-y-3 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[92, 100, 78, 64].map((w, i) => (
        <div key={i} className="h-3.5 rounded-interactive bg-secondary/50" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function TechniqueModal({
  projectId,
  graph,
  node,
  entry,
  onLinkHref,
  onOpenLaw,
  onOpenDoc,
  onOpenInSubjects,
  onClose,
}: {
  projectId: string;
  graph: HierarchyGraph;
  /** The subject node the technique was clicked under (the breadcrumb). */
  node: SubjectNode;
  entry: TechniqueEntry;
  /** Intercepted markdown link: host resolves + routes (may navigate the
   *  graph focus, closing this modal). `currentFile` is the base for
   *  relative resolution. */
  onLinkHref: (currentFile: string, href: string) => boolean;
  onOpenLaw: (lawId: string) => void;
  onOpenDoc: (file: string, anchor: string | null) => void;
  /** Jump lanes: open this technique inside the Subjects master–detail. */
  onOpenInSubjects: (subjectSlug: string, techniqueSlug: string) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;
  const tech = entry.tech;

  const [doc, setDoc] = useState<HierarchyDoc | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setDoc(null);
    setFailed(false);
    getHierarchyDoc(projectId, tech.file, corpusRootFor(projectId))
      .then((d) => { if (live) setDoc(d); })
      .catch((err) => {
        silentCatch('patterns:hierarchyTechniqueDoc')(err);
        if (live) setFailed(true);
      });
    return () => { live = false; };
  }, [projectId, tech.file]);

  // Applications live under the OWNER subject (the technique's canonical home).
  const applications = useMemo(() => {
    const owner = graph.subjects.find((s) => s.slug === tech.subject);
    return owner ? owner.applications.filter((a) => a.technique === tech.slug) : [];
  }, [graph.subjects, tech.subject, tech.slug]);

  return (
    <BaseModal isOpen onClose={onClose} titleId="hierarchy-technique-modal" size="xl" staggerChildren={false}>
      <div className="flex flex-col max-h-[80vh]">
        <div className="flex-shrink-0 border-b border-border/40 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 id="hierarchy-technique-modal" className="typo-heading text-foreground">
              {tech.title}
            </h3>
            <HierarchyStatusChip status={tech.status} />
            {entry.owner && (
              <span className="typo-caption font-mono rounded-interactive border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-primary">
                {tx(p.shared_owner_note, { owner: entry.owner })}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto typo-label rounded-interactive px-2 py-1 text-foreground/85 hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              {t.common.close}
            </button>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* muted-ok: breadcrumb micro-label, structural chrome */}
            <span className="typo-caption text-foreground/50 uppercase tracking-wide">
              {node.subject.title}
            </span>
            {tech.laws.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                {tech.laws.map((id) => {
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
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {failed ? (
            <p className="typo-body text-status-warning">{p.doc_load_failed}</p>
          ) : doc === null ? (
            <BodyGhost />
          ) : !doc.exists ? (
            <p className="typo-body text-foreground">{p.doc_missing}</p>
          ) : (
            <MarkdownRenderer
              content={doc.markdown}
              className="leading-relaxed"
              onLinkClick={(href) => onLinkHref(tech.file, href)}
            />
          )}

          <section>
            {/* muted-ok: section band header, structural chrome */}
            <h4 className="typo-label uppercase tracking-wide text-foreground/50 mb-2">
              {p.modal_applications_heading}
            </h4>
            {applications.length === 0 ? (
              <p className="typo-body text-foreground">{p.modal_applications_empty}</p>
            ) : (
              <div className="space-y-1.5">
                {applications.map((app) => {
                  const name = app.file.split('/').pop() ?? app.file;
                  return (
                    <button
                      key={app.file}
                      type="button"
                      onClick={() => onOpenDoc(app.file, null)}
                      className="w-full flex items-center gap-2.5 text-left rounded-interactive bg-secondary/20 px-2.5 py-2 hover:bg-secondary/40 transition-colors"
                    >
                      <span
                        className={`typo-caption font-mono rounded-interactive border px-1.5 py-0.5 flex-shrink-0 ${STACK_CLASSES[app.stack] ?? STACK_FALLBACK}`}
                      >
                        {app.stack}
                      </span>
                      <span className="typo-body text-foreground truncate flex-1">{name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="flex-shrink-0 flex items-center justify-end border-t border-border/40 px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenInSubjects(node.subject.slug, tech.slug)}
            className="typo-label flex items-center gap-1.5 rounded-interactive border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-primary hover:bg-primary/20 transition-colors"
          >
            {p.open_in_subjects}
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

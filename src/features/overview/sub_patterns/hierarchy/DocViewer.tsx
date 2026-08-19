// Shared markdown-doc overlay for the hierarchy view — deviations open
// `golden-path-deferred-fixes.md` here, Legacy rows open their old
// golden-paths doc, and anything else with a repo-relative path can reuse it.
// Handles `exists: false` with an honest inline notice (a valid-but-absent
// path is a fact worth showing, not an error to swallow).
import { useEffect, useRef, useState } from 'react';

import { getHierarchyDoc } from '@/api/devTools/hierarchy';
import { corpusRootFor } from '@/features/plugins/dev-tools/sub_workspaces/registry/useRegistryLibrary';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { HierarchyDoc } from '@/lib/bindings/HierarchyDoc';
import { silentCatch } from '@/lib/silentCatch';
import { BaseModal } from '@/lib/ui/BaseModal';

/** Calm geometry-matched ghost under the modal chrome while the doc loads. */
function DocGhost() {
  return (
    <div aria-hidden="true" className="space-y-3 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[92, 100, 78, 96, 60].map((w, i) => (
        <div key={i} className="h-3.5 rounded-interactive bg-secondary/50" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function DocViewer({
  projectId,
  relPath,
  anchor,
  onClose,
}: {
  projectId: string;
  relPath: string;
  /** Best-effort scroll target (an `id` inside the rendered body). */
  anchor?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const p = t.overview.patterns_v2;
  const [doc, setDoc] = useState<HierarchyDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    setDoc(null);
    setFailed(false);
    getHierarchyDoc(projectId, relPath, corpusRootFor(projectId))
      .then((d) => { if (live) setDoc(d); })
      .catch((err) => {
        silentCatch('patterns:hierarchyDoc')(err);
        if (live) setFailed(true);
      });
    return () => { live = false; };
  }, [projectId, relPath]);

  // Best-effort anchor scroll once the body is in the DOM. The deferred-fixes
  // anchors are raw `<a id>` HTML that react-markdown may not materialize —
  // when the id is absent the doc simply opens at the top.
  useEffect(() => {
    if (!doc || !anchor) return;
    const raf = requestAnimationFrame(() => {
      const el = bodyRef.current?.querySelector(`#${CSS.escape(anchor)}`);
      el?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [doc, anchor]);

  const title = relPath.split('/').pop() ?? relPath;

  return (
    <BaseModal isOpen onClose={onClose} titleId="hierarchy-doc-viewer" size="xl" staggerChildren={false}>
      <div className="flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-3.5">
          <h3 id="hierarchy-doc-viewer" className="typo-heading text-foreground truncate font-mono">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="typo-label rounded-interactive px-2 py-1 text-foreground/85 hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            {t.common.close}
          </button>
        </div>
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {failed ? (
            <p className="typo-body text-status-warning">{p.doc_load_failed}</p>
          ) : doc === null ? (
            <DocGhost />
          ) : !doc.exists ? (
            <p className="typo-body text-foreground">{p.doc_missing}</p>
          ) : (
            <MarkdownRenderer content={doc.markdown} className="leading-relaxed" />
          )}
        </div>
      </div>
    </BaseModal>
  );
}

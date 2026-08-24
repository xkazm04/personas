// Shared parts for the Subjects-lane design variants (/prototype session
// 2026-08-24). Hoisted out of SubjectDetail so the baseline and every variant
// render doc bodies, law chips and stack badges through ONE implementation —
// a fix made here reaches all tabs. The variant prop contract lives here too:
// the host (SubjectsView) owns ALL data + routing; variants are presentation.
import { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  Boxes,
  Folder,
  Gauge,
  GitBranch,
  Layout,
  Plug,
  Server,
  Shield,
  type LucideIcon,
} from 'lucide-react';

import { getHierarchyDoc } from '@/api/devTools/hierarchy';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { corpusRootFor } from '@/features/plugins/dev-tools/sub_workspaces/registry/useRegistryLibrary';
import { useTranslation } from '@/i18n/useTranslation';
import type { HierarchyDoc } from '@/lib/bindings/HierarchyDoc';
import type { HierarchyGraph } from '@/lib/bindings/HierarchyGraph';
import type { HierarchyScorecard } from '@/lib/bindings/HierarchyScorecard';
import type { SubjectScore } from '@/lib/bindings/SubjectScore';
import { silentCatch } from '@/lib/silentCatch';

import type { CategoryGroup, SubjectMatchInfo } from '../hierarchyModel';
import type { DetailFocus } from '../SubjectDetail';

/** Semantic stack-badge tones — tokens only, one small map, neutral fallback. */
export const STACK_CLASSES: Record<string, string> = {
  react: 'border-status-info/30 bg-status-info/10 text-status-info',
  rust: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  sql: 'border-primary/30 bg-primary/10 text-primary',
  node: 'border-status-success/30 bg-status-success/10 text-status-success',
  process: 'border-border/60 bg-secondary/50 text-foreground/60',
};
export const STACK_FALLBACK = 'border-border/60 bg-secondary/50 text-foreground/60';

/** One glyph per taxonomy category — decorative anchors for rails and plates. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'ui-surfaces': Layout,
  'client-architecture': Boxes,
  'llm-agent': Bot,
  'backend-platform': Server,
  operations: Activity,
  security: Shield,
  integration: Plug,
  'engineering-process': GitBranch,
  'engineering-assessment': Gauge,
};
export const CATEGORY_ICON_FALLBACK: LucideIcon = Folder;

export function categoryIcon(id: string | null): LucideIcon {
  return (id && CATEGORY_ICONS[id]) || CATEGORY_ICON_FALLBACK;
}

/** Calm ghost for an in-flight doc body. */
export function BodyGhost() {
  return (
    <div aria-hidden="true" className="space-y-3 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[95, 100, 82, 70].map((w, i) => (
        <div key={i} className="h-3.5 rounded-interactive bg-secondary/50" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** Lazily fetched markdown body for one repo-relative file. */
export function InlineDocBody({
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
    getHierarchyDoc(projectId, relPath, corpusRootFor(projectId))
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

export function LawChips({
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

/**
 * The contract every design variant renders against. The host owns data,
 * search, selection persistence, cross-link routing and the doc overlay —
 * a variant is layout + typography + motion over these props, nothing else.
 */
export interface SubjectsVariantProps {
  projectId: string;
  graph: HierarchyGraph;
  groups: CategoryGroup[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  /** Null when no search is active; when set, subjects absent from it are hidden. */
  matchMap: Map<string, SubjectMatchInfo> | null;
  scorecard: HierarchyScorecard | null;
  adherence: ReadonlyMap<string, SubjectScore> | null;
  focus: DetailFocus | null;
  onLinkHref: (currentFile: string, href: string) => boolean;
  onOpenDoc: (file: string, anchor: string | null) => void;
  onOpenLaw: (lawId: string) => void;
}

/** Groups filtered by an active search — shared by every variant's nav. */
export function visibleGroupsOf(
  groups: CategoryGroup[],
  matchMap: Map<string, SubjectMatchInfo> | null,
): CategoryGroup[] {
  if (!matchMap) return groups;
  return groups
    .map((g) => ({ ...g, subjects: g.subjects.filter((s) => matchMap.has(s.slug)) }))
    .filter((g) => g.subjects.length > 0);
}

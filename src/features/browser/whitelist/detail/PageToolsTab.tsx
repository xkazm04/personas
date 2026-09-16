/**
 * The tools the PAGE publishes about itself (WebMCP native or the polyfill),
 * with the class the policy derived for each.
 *
 * The manifest is untrusted input: `reversible` and `side_effects` are the
 * page's own claims, and `class` is what Rust decided from them
 * (`auto` iff reversible and not externally visible), possibly tightened by
 * this origin's overrides. The two are shown side by side deliberately — a
 * page claiming a destructive tool is reversible is exactly the thing an
 * operator should be able to see and gate.
 */
import { RotateCcw } from 'lucide-react';

import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';

import type { BrowserPageTool, BrowserSite, BrowserToolClass } from '../../types';

const CLASS_ACCENT: Record<BrowserToolClass, 'slate' | 'emerald' | 'amber'> = {
  read: 'slate',
  auto: 'emerald',
  gated: 'amber',
};

export default function PageToolsTab({ site }: { site: BrowserSite }) {
  const { t } = useTranslation();
  const s = t.browser.scan_report;
  // Annotated rather than inferred: `scan_report` arrives through the generated
  // binding, and an annotation here keeps this file honest about the element
  // type regardless of what that binding currently resolves to.
  const tools: BrowserPageTool[] = site.scan_report?.page_tools ?? [];

  if (tools.length === 0) {
    return <EmptyState title={t.browser.detail.policy_no_tools} description={s.never_scanned} />;
  }

  const classLabel: Record<BrowserToolClass, string> = {
    read: s.tool_class_read,
    auto: s.tool_class_auto,
    gated: s.tool_class_gated,
  };

  const effectLabel: Record<string, string> = {
    none: s.side_effects_none,
    internal: s.side_effects_internal,
    external: s.side_effects_external,
  };

  return (
    <ul className="space-y-2">
      {tools.map((tool) => (
        <li
          key={tool.name}
          className="px-3 py-2 rounded-card border border-primary/10 bg-background/40 min-w-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="typo-body text-foreground font-mono truncate flex-1">{tool.name}</span>
            <StatusBadge accent={CLASS_ACCENT[tool.class]} size="sm">
              {classLabel[tool.class]}
            </StatusBadge>
          </div>
          {tool.description && (
            <p className="typo-caption text-foreground mt-1">{tool.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 typo-caption text-foreground">
            {tool.reversible && (
              <span className="inline-flex items-center gap-1">
                <RotateCcw className="w-3 h-3" />
                {s.reversible}
              </span>
            )}
            <span>{effectLabel[tool.side_effects] ?? tool.side_effects}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

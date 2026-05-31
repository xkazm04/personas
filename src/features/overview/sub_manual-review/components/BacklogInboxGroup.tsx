/**
 * BacklogInboxGroup — the Dev Tools backlog (pending scanned ideas) surfaced as
 * a group inside the Human-Review inbox, so a human triages reviews + backlog
 * candidates in one place (#1). Self-contained: loads pending ideas across all
 * projects (`dev_tools_list_pending_ideas`) and acts inline via the now-real
 * `dev_tools_accept_idea` / `dev_tools_reject_idea` (which persist + write the
 * team learning memory — #2). The reviews list/detail are untouched.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { ScanSearch, ChevronDown, Check, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { silentCatch } from '@/lib/silentCatch';
import * as devApi from '@/api/devTools/devTools';
import type { DevIdea } from '@/lib/bindings/DevIdea';

export function BacklogInboxGroup() {
  const { t } = useTranslation();
  const r = t.overview.review;
  const projects = useSystemStore((s) => s.projects);
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const [ideas, setIdeas] = useState<DevIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIdeas(await devApi.listPendingIdeas(100));
    } catch (err) {
      silentCatch('BacklogInboxGroup:load')(err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (idea: DevIdea, accept: boolean) => {
    setActing(idea.id);
    try {
      if (accept) await devApi.acceptIdea(idea.id);
      else await devApi.rejectIdea(idea.id);
      setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
    } catch (err) {
      silentCatch('BacklogInboxGroup:act')(err);
    } finally {
      setActing(null);
    }
  }, []);

  // Nothing pending → don't take up space in the inbox.
  if (loading || ideas.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-b border-primary/10 bg-amber-500/[0.04]">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-amber-500/[0.06] transition-colors"
      >
        <ScanSearch className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
        <span className="typo-card-label">{r.backlog_group_title}</span>
        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-amber-500/15 text-amber-300 typo-caption font-medium tabular-nums">
          {ideas.length}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-foreground/40 ml-auto transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>

      {!collapsed && (
        <ul className="divide-y divide-primary/5 max-h-64 overflow-y-auto">
          {ideas.map((idea) => (
            <li key={idea.id} className="flex items-center gap-2.5 px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="typo-caption text-foreground truncate block">{idea.title}</span>
                <span className="typo-caption text-foreground/50 truncate block">
                  {(idea.project_id && projectName.get(idea.project_id)) || '—'} · {idea.category}
                  {idea.effort != null && ` · E${idea.effort}`}
                  {idea.impact != null && ` I${idea.impact}`}
                  {idea.risk != null && ` R${idea.risk}`}
                </span>
              </span>
              <Button
                variant="accent"
                accentColor="emerald"
                size="xs"
                icon={<Check className="w-3 h-3" />}
                loading={acting === idea.id}
                onClick={() => void act(idea, true)}
              >
                {r.backlog_accept}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                icon={<X className="w-3 h-3" />}
                disabled={acting === idea.id}
                onClick={() => void act(idea, false)}
              >
                {r.backlog_reject}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

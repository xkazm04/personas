/**
 * GitHubIssueImportModal — list open GitHub issues for a project's linked
 * repo and create one DevGoal per selected issue. Pure frontend: uses the
 * shared `executeApiRequest` proxy through `fetchGitHubIssues`, picks the
 * first matching GitHub credential via the same heuristic the Overview tab
 * already uses, and writes through the existing `createGoal` API.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Loader2, GitBranch, AlertCircle, CheckSquare, Square, Inbox } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { listCredentials } from '@/api/vault/credentials';
import {
  fetchGitHubIssues,
  parseGitHubUrl,
  type GitHubIssueSummary,
} from '../sub_overview/adapters';
import { isGitHubCred } from '../sub_overview/useOverviewData';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  githubUrl: string;
}

type LoadState = 'idle' | 'loading' | 'unmapped' | 'ready' | 'error';

export function GitHubIssueImportModal({ open, onClose, projectId, projectName, githubUrl }: Props) {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const addToast = useToastStore((s) => s.addToast);
  const createGoal = useSystemStore((s) => s.createGoal);

  const parsed = useMemo(() => parseGitHubUrl(githubUrl), [githubUrl]);

  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<GitHubIssueSummary[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);

  // Reset state on every open so a fresh fetch runs.
  useEffect(() => {
    if (!open) return;
    setState('loading');
    setError(null);
    setIssues([]);
    setSelected(new Set());

    let cancelled = false;
    (async () => {
      try {
        if (!parsed) throw new Error(`Could not parse GitHub URL: ${githubUrl}`);
        const creds = (await listCredentials()) as PersonaCredential[];
        const cred = creds.find(isGitHubCred);
        if (!cred) {
          if (!cancelled) setState('unmapped');
          return;
        }
        const rows = await fetchGitHubIssues(cred.id, parsed.owner, parsed.repo);
        if (cancelled) return;
        setIssues(rows);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [open, parsed, githubUrl]);

  const toggle = useCallback((n: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(issues.map((i) => i.number)));
  }, [issues]);

  const clearAll = useCallback(() => setSelected(new Set()), []);

  const handleImport = useCallback(async () => {
    if (selected.size === 0) return;
    setImporting(true);
    let created = 0;
    let failed = 0;
    try {
      for (const issue of issues) {
        if (!selected.has(issue.number)) continue;
        const description = [
          issue.body?.trim().slice(0, 800) ?? '',
          '',
          `Imported from ${issue.htmlUrl}`,
        ].filter(Boolean).join('\n').trim();
        try {
          await createGoal(projectId, issue.title, description || undefined, undefined, undefined, undefined);
          created++;
        } catch {
          failed++;
        }
      }
      if (created > 0) {
        addToast(tx(dt.gh_import_toast_success, { count: created, project: projectName }), 'success');
      }
      if (failed > 0) {
        addToast(tx(dt.gh_import_toast_partial, { failed }), 'error');
      }
      onClose();
    } finally {
      setImporting(false);
    }
  }, [selected, issues, projectId, projectName, createGoal, addToast, tx, dt, onClose]);

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="gh-issue-import-title"
      size="lg"
      // Solid surface — the default glass panel reads as washed-out on top
      // of the projects table. A real card background gives the imported
      // issues list enough contrast to scan quickly.
      panelClassName="max-h-[85vh] bg-card rounded-2xl border border-primary/15 shadow-elevation-4 overflow-hidden"
    >
      <div className="p-5 border-b border-primary/10 flex items-center gap-3">
        <GitBranch className="w-5 h-5 text-foreground" />
        <div className="flex-1 min-w-0">
          <h3 id="gh-issue-import-title" className="typo-section-title">{dt.gh_import_title}</h3>
          <p className="typo-caption text-foreground truncate">
            {parsed ? `${parsed.owner}/${parsed.repo}` : githubUrl}
          </p>
        </div>
      </div>

      <div className="p-5 min-h-[280px] max-h-[60vh] overflow-y-auto">
        {state === 'loading' && (
          <div className="flex items-center justify-center py-16 text-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="typo-body">{dt.gh_import_loading}</span>
          </div>
        )}

        {state === 'unmapped' && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertCircle className="w-7 h-7 text-amber-400" />
            <p className="typo-body text-foreground">{dt.gh_import_no_credential}</p>
            <p className="typo-caption text-foreground max-w-sm">{dt.gh_import_no_credential_hint}</p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertCircle className="w-7 h-7 text-red-400" />
            <p className="typo-body text-foreground">{dt.gh_import_load_failed}</p>
            <p className="typo-caption text-foreground max-w-sm font-mono">{error}</p>
          </div>
        )}

        {state === 'ready' && issues.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="w-7 h-7 text-foreground" />
            <p className="typo-body text-foreground">{dt.gh_import_no_issues}</p>
          </div>
        )}

        {state === 'ready' && issues.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <button type="button" onClick={selectAll} className="typo-caption text-primary hover:underline">{dt.gh_import_select_all}</button>
              <span className="text-foreground">·</span>
              <button type="button" onClick={clearAll} className="typo-caption text-foreground hover:text-foreground">{dt.gh_import_clear}</button>
              <span className="ml-auto typo-caption text-foreground tabular-nums">{tx(dt.gh_import_selected_count, { selected: selected.size, total: issues.length })}</span>
            </div>
            <ul className="space-y-1.5">
              {issues.map((it) => {
                const isOn = selected.has(it.number);
                return (
                  <li key={it.number}>
                    <button
                      type="button"
                      onClick={() => toggle(it.number)}
                      className={`w-full text-left flex items-start gap-2 rounded-modal border p-2.5 transition-colors ${
                        isOn ? 'border-primary/40 bg-primary/8' : 'border-primary/10 bg-card/30 hover:border-primary/25'
                      }`}
                    >
                      {isOn ? <CheckSquare className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" /> : <Square className="w-3.5 h-3.5 text-foreground mt-0.5 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="typo-body text-foreground line-clamp-2">
                          <span className="text-foreground mr-1 tabular-nums">#{it.number}</span>
                          {it.title}
                        </p>
                        {it.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {it.labels.slice(0, 6).map((label) => (
                              <span key={label} className="typo-caption px-1.5 py-0.5 rounded-full bg-primary/5 border border-primary/15 text-foreground">{label}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className="p-4 border-t border-primary/10 flex items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={importing}>{t.common.cancel}</Button>
        <Button
          variant="accent"
          accentColor="violet"
          size="sm"
          onClick={handleImport}
          loading={importing}
          disabled={selected.size === 0 || state !== 'ready'}
        >
          {tx(dt.gh_import_create_btn, { count: selected.size })}
        </Button>
      </div>
    </BaseModal>
  );
}

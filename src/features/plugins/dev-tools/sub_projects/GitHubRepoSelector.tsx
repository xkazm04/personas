import { useState, useEffect, useRef, useCallback } from 'react';
import { Github, ChevronDown, Search, ExternalLink } from 'lucide-react';
import { listCredentials, healthcheckCredential } from '@/api/vault/credentials';
import { executeApiRequest } from '@/api/system/apiProxy';

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  updated_at: string;
}

interface Props {
  value: string;
  onChange: (url: string) => void;
}

/**
 * Universal GitHub project selector.
 *
 * - If the user has a healthy GitHub PAT credential in SQLite, shows a
 *   searchable dropdown of their repositories.
 * - If no credential or the healthcheck fails, the dropdown is hidden
 *   and a simple manual URL input is shown instead.
 * - No errors are ever surfaced to the user.
 */
export function GitHubRepoSelector({ value, onChange }: Props) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [hasSelector, setHasSelector] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // On mount: discover GitHub credential, healthcheck it, fetch repos
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const credentials = await listCredentials();
        const ghCred = credentials.find(
          (c) => c.service_type === 'github' || c.service_type === 'github_actions',
        );
        if (!ghCred) { setLoading(false); return; }

        const health = await healthcheckCredential(ghCred.id);
        if (!health.success) { setLoading(false); return; }

        const res = await executeApiRequest(
          ghCred.id,
          'GET',
          '/user/repos?per_page=100&sort=updated&type=owner',
          { Accept: 'application/vnd.github+json' },
        );

        if (cancelled) return;

        if (res.status === 200) {
          const parsed: GitHubRepo[] = JSON.parse(res.body);
          setRepos(parsed);
          setHasSelector(true);
        }
      } catch {
        // Silently fail -- fall back to manual input
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleSelect = useCallback((repo: GitHubRepo) => {
    onChange(repo.html_url);
    setOpen(false);
    setSearch('');
  }, [onChange]);

  // While loading, render nothing (avoids layout shift)
  if (loading) return null;

  // ---- Manual URL input (fallback when no credential) ----
  if (!hasSelector) {
    return (
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <Github className="w-3 h-3" />
          GitHub URL
          <span className="text-[10px] text-muted-foreground/40 font-normal">(optional)</span>
        </label>
        <div className="relative">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="w-full px-3 py-2 pr-8 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus-ring"
          />
          {value && (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // ---- Repo picker dropdown (credential available) ----
  const filtered = search
    ? repos.filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase()))
    : repos;

  const selectedRepoName = repos.find((r) => r.html_url === value)?.full_name;

  return (
    <div className="relative">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
        <Github className="w-3 h-3" />
        GitHub Repository
        <span className="text-[10px] text-muted-foreground/40 font-normal">(optional)</span>
      </label>
      <button
        type="button"
        onClick={() => { setOpen(!open); setTimeout(() => searchRef.current?.focus(), 50); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl hover:bg-secondary/60 transition-colors text-left"
      >
        <Github className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
        {selectedRepoName ? (
          <span className="flex-1 text-foreground truncate">{selectedRepoName}</span>
        ) : (
          <span className="flex-1 text-muted-foreground/50">Select a repository...</span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(''); }} />
          <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-primary/15 bg-background shadow-xl overflow-hidden max-h-64 flex flex-col">
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
              <Search className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter repositories..."
                className="flex-1 text-xs bg-transparent text-foreground placeholder:text-muted-foreground/40 outline-none"
              />
            </div>
            {/* Repo list */}
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground/50 text-center">
                  No repositories found
                </div>
              ) : (
                filtered.map((repo) => (
                  <button
                    key={repo.full_name}
                    type="button"
                    onClick={() => handleSelect(repo)}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-primary/5 transition-colors ${
                      value === repo.html_url ? 'bg-primary/10' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground/80 truncate">{repo.full_name}</span>
                        {repo.private && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">private</span>
                        )}
                      </div>
                      {repo.description && (
                        <p className="text-[11px] text-muted-foreground/50 truncate mt-0.5">{repo.description}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

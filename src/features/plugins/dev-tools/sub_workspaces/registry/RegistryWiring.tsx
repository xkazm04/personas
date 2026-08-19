// The setup path both directions share: pick a GitHub credential → pick a repo →
// dispatch the pairing task. Hoisted out of the variants on purpose — it is the
// part the operator's brief FIXES ("both should use GitHub connection to pick a
// repo, LLM task should then dispatch pairing"), so it is not what the two
// directions are competing over and refining it twice would be pure waste.
//
// The repo list is real: `github_list_repos` is already a registered command and
// `githubListRepos` already wraps it, so this reads the operator's actual repos
// through the Vault credential rather than a fixture.

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { githubListRepos } from '@/api/agents/automations';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { silentCatch } from '@/lib/silentCatch';
import type { GitHubRepo } from '@/lib/bindings/GitHubRepo';
import type { CredentialMetadata } from '@/lib/types/types';
import { useVaultStore } from '@/stores/vaultStore';

import { dispatchPairing, linkRegistry, type Registry } from './registryLinkStore';

/** Where a registry clone lands. One per registry — see the store's header. */
export function suggestedClonePath(fullName: string): string {
  return `~/.personas/registries/${fullName.replace('/', '__')}`;
}

export function useGithubCredentials(): CredentialMetadata[] {
  const credentials = useVaultStore((s) => s.credentials);
  return useMemo(
    () => credentials.filter((c: CredentialMetadata) => c.service_type === 'github'),
    [credentials],
  );
}

export function RegistryWiring({
  workspaceId,
  dispatchCwd,
  onLinked,
}: {
  workspaceId: string;
  /** A directory that EXISTS — the clone does not yet, so it cannot be the cwd. */
  dispatchCwd: string | null;
  onLinked?: (registry: Registry) => void;
}) {
  const credentials = useGithubCredentials();
  const [credentialId, setCredentialId] = useState<string>('');
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [repoName, setRepoName] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!credentialId && credentials.length === 1) setCredentialId(credentials[0]!.id);
  }, [credentials, credentialId]);

  useEffect(() => {
    if (!credentialId) {
      setRepos(null);
      return;
    }
    let cancelled = false;
    setRepos(null);
    setLoadError(null);
    githubListRepos(credentialId)
      .then((list) => {
        if (!cancelled) setRepos(list);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setRepos([]);
        silentCatch('RegistryWiring:githubListRepos')(e);
      });
    return () => {
      cancelled = true;
    };
  }, [credentialId]);

  const repo = repos?.find((r) => r.fullName === repoName) ?? null;
  const ready = Boolean(repo && credentialId && dispatchCwd);

  if (credentials.length === 0) {
    return (
      <p className="typo-body text-muted-foreground">
        No GitHub credential in the Vault yet. Add one under Vault → Credentials; the registry is a
        repository, so the connection is the same one any other GitHub work uses.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <ThemedSelect
          value={credentialId}
          onValueChange={(v) => {
            setCredentialId(v);
            setRepoName('');
          }}
          aria-label="GitHub credential"
          options={credentials.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="GitHub credential"
          filterable
          hideSearch
        />
        <ThemedSelect
          value={repoName}
          onValueChange={setRepoName}
          aria-label="Registry repository"
          disabled={!credentialId || repos === null}
          options={(repos ?? []).map((r) => ({
            value: r.fullName,
            label: r.private ? `${r.fullName} (private)` : r.fullName,
          }))}
          placeholder={
            !credentialId ? 'Pick a credential first' : repos === null ? 'Reading repositories…' : 'Registry repository'
          }
          filterable
        />
      </div>

      {loadError && (
        <p className="typo-caption text-status-error">
          Could not read repositories: {loadError}
        </p>
      )}

      {repo && (
        <p className="typo-caption text-muted-foreground">
          Clone lands at <span className="text-foreground/80">{suggestedClonePath(repo.fullName)}</span> — one clone per
          registry, shared by every workspace wired to it.
        </p>
      )}

      {!dispatchCwd && (
        <p className="typo-caption text-status-warning">
          This workspace has no member project yet. The pairing task runs from a real directory, so add a project first.
        </p>
      )}

      <div>
        <AsyncButton
          size="sm"
          disabled={!ready}
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          onClick={async () => {
            if (!repo || !dispatchCwd) return;
            const registry = linkRegistry(
              workspaceId,
              { fullName: repo.fullName, defaultBranch: repo.defaultBranch },
              credentialId,
            );
            await dispatchPairing(registry, dispatchCwd, suggestedClonePath(repo.fullName));
            onLinked?.(registry);
          }}
        >
          Pair registry
        </AsyncButton>
      </div>
    </div>
  );
}

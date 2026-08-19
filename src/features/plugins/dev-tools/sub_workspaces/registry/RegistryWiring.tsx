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
import { DirectoryPickerInput } from '@/features/shared/components/forms/DirectoryPickerInput';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { GitHubRepo } from '@/lib/bindings/GitHubRepo';
import type { CredentialMetadata } from '@/lib/types/types';
import { useVaultStore } from '@/stores/vaultStore';

import { dispatchPairing, linkRegistry, type Registry } from './registryLinkStore';

// The clone path is CHOSEN, not derived — see `Registry.clonePath`. A scan skill
// reads the registry working copy and the project repos side by side, so a URL
// alone is not a usable wiring; and letting the operator point at an existing
// clone beats silently making a second one.

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
  const { t, tx } = useTranslation();
  const tr = t.plugins.dev_tools.registry;
  const credentials = useGithubCredentials();
  const [credentialId, setCredentialId] = useState<string>('');
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [repoName, setRepoName] = useState<string>('');
  const [clonePath, setClonePath] = useState<string>('');
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
  const ready = Boolean(repo && credentialId && dispatchCwd && clonePath.trim());

  if (credentials.length === 0) {
    return (
      <p className="typo-body text-foreground">{tr.no_credential}</p>
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
          aria-label={tr.credential_label}
          options={credentials.map((c) => ({ value: c.id, label: c.name }))}
          placeholder={tr.credential_label}
          filterable
          hideSearch
        />
        <ThemedSelect
          value={repoName}
          onValueChange={setRepoName}
          aria-label={tr.repo_label}
          disabled={!credentialId || repos === null}
          options={(repos ?? []).map((r) => ({
            value: r.fullName,
            label: r.private ? tx(tr.repo_private, { name: r.fullName }) : r.fullName,
          }))}
          placeholder={
            !credentialId ? tr.repo_pick_credential_first : repos === null ? tr.repo_loading : tr.repo_label
          }
          filterable
        />
      </div>

      {loadError && (
        <p className="typo-caption text-status-error">{tx(tr.load_error, { error: loadError })}</p>
      )}

      <div className="flex flex-col gap-1">
        <DirectoryPickerInput
          value={clonePath}
          onChange={setClonePath}
          placeholder={tr.path_placeholder}
        />
        <p className="typo-caption text-foreground/70">{tr.path_hint}</p>
      </div>

      {!dispatchCwd && (
        <p className="typo-caption text-status-warning">{tr.no_project}</p>
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
              clonePath.trim(),
            );
            await dispatchPairing(registry, dispatchCwd);
            onLinked?.(registry);
          }}
        >
          {tr.pair}
        </AsyncButton>
      </div>
    </div>
  );
}

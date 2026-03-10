import { useState, useEffect } from 'react';
import type { AutomationPlatform } from '@/lib/bindings/PersonaAutomation';
import { githubListRepos, githubCheckPermissions, zapierListZaps } from '@/api/agents/automations';
import type { GitHubRepo, GitHubPermissions, ZapierZap } from '@/api/agents/automations';

export function usePlatformData(platform: AutomationPlatform, platformCredentialId: string | null) {
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubPerms, setGithubPerms] = useState<GitHubPermissions | null>(null);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);

  const [zapierZaps, setZapierZaps] = useState<ZapierZap[]>([]);
  const [loadingZaps, setLoadingZaps] = useState(false);

  // Fetch GitHub repos when platform is github_actions and credential is available
  useEffect(() => {
    if (platform !== 'github_actions' || !platformCredentialId) {
      setGithubRepos([]);
      setGithubPerms(null);
      setGithubRepo(null);
      return;
    }
    setLoadingRepos(true);
    Promise.all([
      githubListRepos(platformCredentialId).catch(() => [] as GitHubRepo[]),
      githubCheckPermissions(platformCredentialId).catch(() => null),
    ]).then(([repos, perms]) => {
      setGithubRepos(repos);
      setGithubPerms(perms);
      setLoadingRepos(false);
    });
  }, [platform, platformCredentialId]);

  // Fetch Zapier zaps when platform is zapier and credential is available
  useEffect(() => {
    if (platform !== 'zapier' || !platformCredentialId) {
      setZapierZaps([]);
      return;
    }
    setLoadingZaps(true);
    zapierListZaps(platformCredentialId)
      .then((zaps) => { setZapierZaps(zaps); setLoadingZaps(false); })
      .catch(() => { setZapierZaps([]); setLoadingZaps(false); });
  }, [platform, platformCredentialId]);

  const resetPlatformData = () => {
    setGithubRepo(null);
    setGithubRepos([]);
    setGithubPerms(null);
    setZapierZaps([]);
  };

  return {
    githubRepos, githubPerms, githubRepo, setGithubRepo, loadingRepos,
    zapierZaps, loadingZaps,
    resetPlatformData,
  };
}

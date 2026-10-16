// Opens a repo-relative path (a doc, a source it names) with the OS, through
// the app's one door for that (`open_local_path`), resolved against the root of
// the project Lifecycle is focused on. The door refuses a path that does not exist, which is why a
// broken reference is never offered an Open: only a copy. A failure is kept
// for the caller to say inline (no toasts on this surface).
import { useCallback, useState } from 'react';

import { openLocalPath } from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { useLifecycleViewModel } from '../../context';

/** The project root joined to a repo-relative path, in the root's own separator. */
export function repoPath(root: string, rel: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const head = root.replace(/[\\/]+$/, '');
  return `${head}${sep}${rel.replace(/^[\\/]+/, '').split(/[\\/]/).join(sep)}`;
}

export function useOpenInRepo() {
  // No focused project, or one whose row is gone: nothing to resolve against, so no Open is offered (copy still is).
  const { projectId } = useLifecycleViewModel();
  const root = useSystemStore((s) => {
    const project = s.projects.find((p) => p.id === projectId);
    return project ? project.root_path : null;
  });
  const [failed, setFailed] = useState<string | null>(null);
  const open = useCallback(async (rel: string) => {
    if (!root) return;
    setFailed(null);
    try {
      await openLocalPath(repoPath(root, rel));
    } catch (err) {
      silentCatch('lifecycle docs: open a repo path')(err);
      setFailed(rel);
    }
  }, [root]);
  return { canOpen: root != null, open, failed };
}

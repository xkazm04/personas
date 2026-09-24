// A new project's name is checked in the form, before anything is created, by
// asking the backend (`webbuild_check_name`): it applies the scaffold's own
// rule (the folder must not already exist), so the form cannot disagree with
// the scaffold. A taken name used to be refused only after submit, as a toast,
// while Studio fell back to showing the other project.
import { useEffect, useState } from 'react';
import { webbuildCheckName } from '@/api/webbuild';
import { silentCatch } from '@/lib/silentCatch';
import type { ProjectNameCheck } from '@/lib/bindings/ProjectNameCheck';

export type NameProblem = 'unsafe' | 'taken';

/** Why a checked name cannot be used, or null. */
export function problemOf(check: ProjectNameCheck | null): NameProblem | null {
  if (!check) return null;
  if (check.slug === null) return 'unsafe';
  return check.taken ? 'taken' : null;
}

/**
 * The backend's verdict on `name`, debounced. `checking` is true while the
 * answer for the current text is still outstanding, so the form can hold its
 * submit until the verdict is in.
 */
export function useNameCheck(name: string, delayMs = 150) {
  const [result, setResult] = useState<{ name: string; check: ProjectNameCheck } | null>(null);
  const trimmed = name.trim();
  useEffect(() => {
    if (!trimmed) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      webbuildCheckName(trimmed)
        .then((check) => alive && setResult({ name: trimmed, check }))
        .catch(silentCatch('studioNames:check'));
    }, delayMs);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [trimmed, delayMs]);
  const current = result && result.name === trimmed ? result.check : null;
  return {
    problem: trimmed ? problemOf(current) : null,
    checking: !!trimmed && !current,
  };
}

/** A free name for a starter: the base when free, else the backend's suggestion. */
export async function freeName(base: string): Promise<string> {
  try {
    const check = await webbuildCheckName(base);
    return check.taken && check.suggestion ? check.suggestion : base;
  } catch (e) {
    silentCatch('studioNames:freeName')(e);
    return base;
  }
}

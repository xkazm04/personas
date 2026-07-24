// Shared logic for the "Run a skill" modal (green Skills cell → background
// Fleet run). Both prototype variants (Launcher / Composer) import from here so
// data-fetch, command assembly and the usage-hint heuristic live in one place.
import { useEffect, useState } from 'react';

import { listSkills, type SkillEntry } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';

export type { SkillEntry };

export interface SkillListState {
  skills: SkillEntry[];
  loading: boolean;
  /** True once the fetch settled but returned nothing installed. */
  empty: boolean;
}

/** Identical props every "Run a skill" variant receives from the host, so the
 *  prototype tab switcher can swap bodies without touching call sites. */
export interface SkillRunVariantProps {
  /** Project (island) display name. */
  name: string;
  /** Installed-skill list state (fetched once by the host). */
  state: SkillListState;
  /** Dispatch `/skill args` as a background Fleet session. Rejects on failure
   *  so the variant keeps the modal open and re-enables its button. */
  onRun: (skill: string, args: string) => Promise<void>;
  onClose: () => void;
}

/** Fetch a project's installed skills (`.claude/skills`) once per open. Tolerant:
 *  a failed probe resolves to an empty list (the modal shows the empty state
 *  rather than an error — the dimension was green, so this is unexpected but
 *  non-fatal). Sorted by name for a stable, scannable list. */
export function useProjectSkills(slug: string): SkillListState {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    listSkills(slug)
      .then((rows) => { if (alive) setSkills([...rows].sort((a, b) => a.name.localeCompare(b.name))); })
      .catch((e) => { silentCatch('mastermind useProjectSkills')(e); if (alive) setSkills([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);
  return { skills, loading, empty: !loading && skills.length === 0 };
}

/** The Fleet prompt for a skill run: `/name` plus any trimmed args. Slash
 *  commands are recognized when the first prompt starts with `/`. */
export function skillCommand(name: string, args: string): string {
  const a = args.trim();
  return a ? `/${name} ${a}` : `/${name}`;
}

/** Best-effort usage hint pulled from a skill's description. Skills document
 *  invocation inconsistently, so this is heuristic, not authoritative:
 *   1. a backticked slash-command span — `/kpi-sim run [--l2] …`
 *   2. an "Invoke with …" clause (up to the sentence end)
 *  Returns null when neither is present (the caller then shows the plain
 *  description as context instead). */
export function usageHint(description: string | null): string | null {
  if (!description) return null;
  const code = description.match(/`(\/[a-z0-9][^`]*)`/i);
  if (code?.[1]) return code[1].trim();
  const invoke = description.match(/Invoke with[:\s]+([^.]+)/i);
  if (invoke?.[1]) return invoke[1].replace(/`/g, '').trim();
  return null;
}

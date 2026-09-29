// i18n + glyph lookups for the Lifecycle vocabulary (step ids, binding kinds,
// binding states, outcomes, source kinds). Shared by the journey view, its
// detail layer and the project form's preset picker; the contest winner that
// replaces the interim view reuses it too.
import {
  BookOpen, CheckCheck, FileText, FlaskConical, GitBranch, GitCommitHorizontal, GitMerge,
  Link2, RefreshCw, ScrollText, ShieldCheck, Sparkles, Target, type LucideIcon,
} from 'lucide-react';

import type { Translations } from '@/i18n/en';
import type { LifecycleAuthor } from '@/lib/bindings/LifecycleAuthor';
import type { LifecycleBindingKind } from '@/lib/bindings/LifecycleBindingKind';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { LifecyclePreset } from '@/lib/bindings/LifecyclePreset';
import type { LifecycleSourceKind } from '@/lib/bindings/LifecycleSourceKind';

type Dl = Translations['plugins']['dev_lifecycle'];

const STEP_KEYS = {
  frame: 'lc_step_frame',
  recall: 'lc_step_recall',
  isolate: 'lc_step_isolate',
  link: 'lc_step_link',
  sync: 'lc_step_sync',
  gate: 'lc_step_gate',
  tests: 'lc_step_tests',
  docs: 'lc_step_docs',
  commit: 'lc_step_commit',
  land: 'lc_step_land',
  record: 'lc_step_record',
} as const satisfies Record<string, keyof Dl>;

const STEP_GLYPHS: Record<keyof typeof STEP_KEYS, LucideIcon> = {
  frame: Target,
  recall: BookOpen,
  isolate: GitBranch,
  link: Link2,
  sync: RefreshCw,
  gate: ShieldCheck,
  tests: FlaskConical,
  docs: FileText,
  commit: GitCommitHorizontal,
  land: GitMerge,
  record: ScrollText,
};

function isBuiltIn(id: string): id is keyof typeof STEP_KEYS {
  return Object.prototype.hasOwnProperty.call(STEP_KEYS, id);
}

/** A step's display label: i18n for a built-in id, the step's own label for a custom `x-<slug>`. */
export function stepLabel(dl: Dl, id: string, label: string | null = null): string {
  if (isBuiltIn(id)) return dl[STEP_KEYS[id]];
  return label ?? id;
}

export function stepGlyph(id: string): LucideIcon {
  return isBuiltIn(id) ? STEP_GLYPHS[id] : Sparkles;
}

export function presetLabel(dl: Dl, preset: LifecyclePreset): string {
  return preset === 'team' ? dl.lc_preset_team : dl.lc_preset_solo;
}

export function authorLabel(dl: Dl, author: LifecycleAuthor): string | null {
  switch (author) {
    case 'operator': return dl.lc_author_operator;
    case 'athena': return dl.lc_author_athena;
    case 'system': return dl.lc_author_system;
    case 'default': return null;
  }
}

export function bindingKindLabel(dl: Dl, kind: LifecycleBindingKind): string {
  switch (kind) {
    case 'app': return dl.lc_binding_app;
    case 'claude_md': return dl.lc_binding_claude_md;
    case 'hook': return dl.lc_binding_hook;
    case 'ci': return dl.lc_binding_ci;
    case 'advisory': return dl.lc_binding_advisory;
  }
}

export function bindingStateLabel(dl: Dl, state: LifecycleBindingState): string {
  switch (state) {
    case 'live': return dl.lc_state_live;
    case 'detected': return dl.lc_state_detected;
    case 'pending': return dl.lc_state_pending;
    case 'missing': return dl.lc_state_missing;
    case 'advisory': return dl.lc_state_advisory;
  }
}

/** The state as a clause inside the weakest-step sentence. */
export function bindingStatePhrase(dl: Dl, state: LifecycleBindingState): string {
  switch (state) {
    case 'live': return dl.lc_state_phrase_live;
    case 'detected': return dl.lc_state_phrase_detected;
    case 'pending': return dl.lc_state_phrase_pending;
    case 'missing': return dl.lc_state_phrase_missing;
    case 'advisory': return dl.lc_state_phrase_advisory;
  }
}

export function outcomeLabel(dl: Dl, outcome: LifecycleOutcome): string {
  switch (outcome) {
    case 'done': return dl.lc_outcome_done;
    case 'skipped': return dl.lc_outcome_skipped;
    case 'unknown': return dl.lc_outcome_unknown;
    case 'failed': return dl.lc_outcome_failed;
  }
}

export function sourceKindLabel(dl: Dl, kind: LifecycleSourceKind): string {
  switch (kind) {
    case 'task': return dl.lc_source_task;
    case 'commit': return dl.lc_source_commit;
    case 'pr': return dl.lc_source_pr;
  }
}

/** Glyph for an evidence source in the detail layer. */
export function sourceKindGlyph(kind: LifecycleSourceKind): LucideIcon {
  if (kind === 'task') return CheckCheck;
  if (kind === 'pr') return GitMerge;
  return GitCommitHorizontal;
}

import type { CredentialMetadata } from '@/lib/types/types';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';

// -- Tag color presets ------------------------------------------------

export const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  production:  { bg: 'bg-red-500/10',    text: 'text-red-400',    border: 'border-red-500/20' },
  staging:     { bg: 'bg-amber-500/10',   text: 'text-amber-400',  border: 'border-amber-500/20' },
  development: { bg: 'bg-blue-500/10',    text: 'text-blue-400',   border: 'border-blue-500/20' },
  personal:    { bg: 'bg-violet-500/10',  text: 'text-violet-400', border: 'border-violet-500/20' },
  shared:      { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',   border: 'border-cyan-500/20' },
  testing:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
};

const DEFAULT_TAG_STYLE = { bg: 'bg-secondary/40', text: 'text-muted-foreground/80', border: 'border-primary/15' };

export function getTagStyle(tag: string) {
  return TAG_COLORS[tag.toLowerCase()] ?? DEFAULT_TAG_STYLE;
}

// -- Metadata helpers -------------------------------------------------

function parseMetadata(metadata: string | null): Record<string, unknown> {
  return parseJsonOrDefault<Record<string, unknown>>(metadata, {});
}

export function getCredentialTags(credential: CredentialMetadata): string[] {
  const parsed = parseMetadata(credential.metadata);
  const tags = parsed.tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === 'string');
}

export function buildMetadataWithTags(credential: CredentialMetadata, tags: string[]): string {
  const parsed = parseMetadata(credential.metadata);
  const next = { ...parsed, tags: tags.length > 0 ? tags : undefined };
  if (!next.tags) delete next.tags;
  return JSON.stringify(next);
}

/** Collect all unique tags across all credentials */
export function collectAllTags(credentials: CredentialMetadata[]): string[] {
  const set = new Set<string>();
  for (const cred of credentials) {
    for (const tag of getCredentialTags(cred)) {
      set.add(tag);
    }
  }
  return [...set].sort();
}

// -- Suggested tags (pre-populated autocomplete) ----------------------

export const SUGGESTED_TAGS = ['production', 'staging', 'development', 'personal', 'shared', 'testing'];

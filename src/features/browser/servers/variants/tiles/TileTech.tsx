/**
 * Live tiles: the tech stack as icon wells, larger than the shared
 * `TechIconStrip` (14px) because a tile is the least dense surface and the
 * operator's bar is "nothing small". Same resolver (`resolveTechIcon`); a
 * token with no icon renders as its own text, never dropped.
 */
import { useMemo } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';

const MAX = 5;

interface TechMark {
  key: string;
  label: string;
  icon: { path: string; color?: string; title: string } | null;
}

export function techMarks(tokens: readonly string[]): TechMark[] {
  const seen = new Set<string>();
  const out: TechMark[] = [];
  for (const label of tokens) {
    const match = resolveTechIcon(label);
    const key = match ? `icon:${match.icon.title}` : `text:${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, icon: match ? match.icon : null });
  }
  return out;
}

export function TileTech({ tokens, label }: { tokens: readonly string[]; label: string }) {
  const marks = useMemo(() => techMarks(tokens), [tokens]);
  if (marks.length === 0) return null;
  const shown = marks.slice(0, MAX);
  const rest = marks.length - shown.length;
  return (
    <span className="lt-tech" role="list" aria-label={label}>
      {shown.map((m) => (
        <span key={m.key} role="listitem">
          {m.icon ? (
            <Tooltip content={m.label}>
              <span className="lt-tech__well" aria-label={m.label}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill={m.icon.color ?? 'currentColor'} aria-hidden>
                  <path d={m.icon.path} />
                </svg>
              </span>
            </Tooltip>
          ) : (
            <span className="lt-tech__token typo-caption text-foreground">{m.label}</span>
          )}
        </span>
      ))}
      {rest > 0 && <span className="typo-caption text-foreground">+{rest}</span>}
    </span>
  );
}

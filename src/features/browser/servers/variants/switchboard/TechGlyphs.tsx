/**
 * The tech stack as brand glyphs at row size, with the token's text standing in
 * where no icon resolves. `TechIconStrip` (centerShared) draws 14px glyphs and
 * drops unresolved tokens, so a stack it cannot read renders as nothing; the
 * Switchboard needs both a larger glyph and the fallback. Candidate for
 * promotion beside TechIconStrip (reported to the Director).
 */
import { useMemo } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';

const MAX = 5;

export function TechGlyphs({ tokens }: { tokens: readonly string[] }) {
  const items = useMemo(() => {
    const seen = new Set<string>();
    return tokens.flatMap((label) => {
      const match = resolveTechIcon(label);
      const key = match ? match.icon.title : label.toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, label, icon: match?.icon ?? null }];
    });
  }, [tokens]);

  const shown = items.slice(0, MAX);
  return (
    <span className="sb-tech">
      {shown.map((item) => (
        <Tooltip key={item.key} content={item.label}>
          {item.icon ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill={item.icon.color ?? 'currentColor'} aria-label={item.label} role="img">
              <path d={item.icon.path} />
            </svg>
          ) : (
            <span className="typo-label text-foreground sb-tech__word">{item.label}</span>
          )}
        </Tooltip>
      ))}
      {items.length > MAX && <span className="typo-caption">+{items.length - MAX}</span>}
    </span>
  );
}

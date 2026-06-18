// PersonaGlyph — the persona avatar for the compact monitor variants. Renders
// the persona icon when one is specified, otherwise an "iconized initials"
// chip (first letters of two words) in the persona's colour (goal 2).

import { resolvePersonaIcon } from '@/lib/icons/resolvePersonaIcon';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { personaInitials } from '@/lib/icons/personaInitials';

const SIZE = {
  sm: { box: 'w-7 h-7', text: 'typo-caption' },
  md: { box: 'w-9 h-9', text: 'typo-body' },
} as const;

export function PersonaGlyph({
  icon, color, name, size = 'sm',
}: {
  icon: string | null;
  color: string | null;
  name: string;
  size?: keyof typeof SIZE;
}) {
  const resolved = resolvePersonaIcon(icon);
  const s = SIZE[size];

  // No real icon → initials chip in the persona's colour.
  if (resolved.kind === 'fallback') {
    const c = color ?? 'var(--color-primary)';
    return (
      <span
        aria-hidden
        className={`inline-flex flex-shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums ${s.box} ${s.text}`}
        style={{ backgroundColor: colorWithAlpha(c, 0.18), color: c, borderColor: colorWithAlpha(c, 0.4) }}
      >
        {personaInitials(name)}
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-shrink-0 items-center justify-center ${s.box}`}>
      <PersonaIcon icon={icon} color={color} display="pop" frameSize="sm" />
    </span>
  );
}

// TeamBadge — a team rendered as its initials, tinted in the team's own colour.
//
// Keeps team columns / pods slim: the team is an initials chip (e.g. "WP" for
// "Web Platform"), not a full name. Shared by both grid variants so the team
// glyph reads identically whether it heads a column or a pod.

import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { initialsOf, cleanName } from './fleetGridModel';

export function TeamBadge({
  name, color, size = 30, shape = 'square',
}: {
  name: string;
  color: string;
  size?: number;
  shape?: 'square' | 'circle';
}) {
  return (
    <span
      title={cleanName(name)}
      className={`inline-flex flex-shrink-0 items-center justify-center border font-bold leading-none ${
        shape === 'circle' ? 'rounded-full' : 'rounded-input'
      }`}
      style={{
        width: size,
        height: size,
        backgroundColor: colorWithAlpha(color, 0.18),
        borderColor: colorWithAlpha(color, 0.5),
        color,
      }}
    >
      <span className="text-xs">{initialsOf(name)}</span>
    </span>
  );
}

export default TeamBadge;

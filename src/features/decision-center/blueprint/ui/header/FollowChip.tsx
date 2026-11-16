import { useSheet } from '../../controller/SheetContext';
import { Press } from '../Press';
import '../../styles/follow.css';

/**
 * Follow (header, beside the changes chip; a live product only): off, "Follow bp"; on, "Following <who moved>", or
 * "bp offline" while bp does not answer (Rust says so every 5 s, never an error each second). Pressing it follows
 * whoever moves in bp, or stops. Personas follows and never publishes (spark roadmap S6, G7 left to the owner).
 */
export function FollowChip() {
  const s = useSheet();
  const { B, tx } = s.text;
  const f = s.follow;
  if (!f.available) return null;
  const words = !f.on ? B.follow_bp : f.online === false ? B.follow_offline : f.from ? tx(B.follow_on, { who: f.from }) : B.follow_waiting;
  return (
    <Press
      tone={`bp-chg bp-follow${f.on ? ' bp-on' : ''}${f.on && f.online === false ? ' bp-off' : ''}`}
      on={f.on}
      aria-label={B.follow_label}
      onClick={f.toggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
      data-testid="blueprint-follow-chip"
      data-online={f.online === null ? undefined : String(f.online)}
    >
      <i aria-hidden="true" />{words}
    </Press>
  );
}

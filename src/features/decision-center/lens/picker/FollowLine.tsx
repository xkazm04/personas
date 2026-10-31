/**
 * FollowLine - Follow bp on the Monitor's Blueprint and Morning tabs (spark roadmap S6, G5): the sheet header's Follow
 * chip in the picker's `.pj-bt` dress, and what the last shared place could not do. While a tab is on screen Personas is
 * one of bp's readers (bp's chip lists "Personas"); with Follow on, a place bp moves to opens the product's drawing at it.
 * A product bp names that Personas has not got holds still and says "Not in Personas: <slug>". Follower only: nothing
 * here publishes (G7 is the owner's).
 */
import { useTranslation } from '@/i18n/useTranslation';

import { Press } from '../../blueprint/ui/Press';
import { noteWords } from '../../blueprint/controller/useFocusFollow';
import type { BpFollower } from '../bpFollower';
import { useFollowerState } from '../useBpFollow';

export function FollowLine({ follower }: { follower: BpFollower }) {
  const { t, tx } = useTranslation();
  const B = t.decisionCenter.blueprint;
  const st = useFollowerState(follower);
  if (!st) return null;
  const words = !st.on ? B.follow_bp : st.online === false ? B.follow_offline : st.from ? tx(B.follow_on, { who: st.from }) : B.follow_waiting;
  return (
    <div className="pj-follow" data-testid="picker-follow">
      <Press
        tone={`pj-bt pj-fchip${st.on ? ' on' : ''}${st.on && st.online === false ? ' off' : ''}`}
        on={st.on}
        aria-label={B.follow_label}
        onClick={follower.toggle}
        data-testid="picker-follow-chip"
        data-online={st.online === null ? undefined : String(st.online)}
      >
        <i aria-hidden="true" />{words}
      </Press>
      <span className="pj-fnote" role="status" data-testid="picker-follow-note">{st.on && st.note ? noteWords(st.note, { B, tx }) : ''}</span>
    </div>
  );
}

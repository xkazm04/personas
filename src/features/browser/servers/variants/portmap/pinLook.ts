// How one pin of the Port map reads at a glance: the tone class, whether it is
// lit (ours and holding the port) or a ghost (someone else's listener), and
// whether it is scanning. A collision pin speaks for its live server first.

import type { DevServerView } from '@/lib/bindings/DevServerView';

import { SERVER_TONE, isLive } from '../../serverTone';
import type { AxisPin } from './portAxis';

export interface PinLook {
  lead: DevServerView;
  /** `pm-t-<tone>`: sets --pm-tone for the card, leader, tick and figure. */
  tone: string;
  /** '' | 'is-lit' | 'is-ghost' */
  state: string;
  scan: boolean;
}

export function pinLook(pin: AxisPin): PinLook {
  const lead = pin.servers.find((s) => isLive(s.state)) ?? pin.servers[0]!;
  const lit = lead.state === 'running' || lead.state === 'starting';
  return {
    lead,
    tone: `pm-t-${SERVER_TONE[lead.state].tone}`,
    state: lit ? 'is-lit' : lead.state === 'external' ? 'is-ghost' : '',
    scan: lead.state === 'scanning',
  };
}

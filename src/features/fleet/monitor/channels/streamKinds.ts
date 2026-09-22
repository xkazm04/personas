import { Brain, Hash, Layers, Radio, Signal, Users, type LucideIcon } from 'lucide-react';
import type { Translations } from '@/i18n/en';
import type { ChannelKind } from '@/api/pipeline/teamChannel';
import { STEP_VERB_KEY, type StepVerb } from '@/features/teams/sub_collab/decisionTitle';

/* ----------------------------------------------------------------------------
 * STREAM KINDS — one icon per source, shared by the tuner rail and the row, so
 * the glyph a row wears is the glyph you click to filter it. Labels are i18n
 * KEYS (a module constant cannot call a hook); resolve at render.
 *
 * Every ChannelKind keeps an entry even though the Stream only renders the four
 * STREAM_KINDS — the typed record is what makes a new kind a compile error.
 * -------------------------------------------------------------------------- */

export const KIND_META: Record<ChannelKind, { labelKey: keyof Translations['monitor']; icon: LucideIcon }> = {
  step: { labelKey: 'stream_kind_step', icon: Layers },
  event: { labelKey: 'stream_kind_event', icon: Signal },
  memory: { labelKey: 'stream_kind_memory', icon: Brain },
  message: { labelKey: 'stream_kind_message', icon: Users },
  deliberation: { labelKey: 'stream_kind_deliberation', icon: Radio },
  slack: { labelKey: 'stream_kind_slack', icon: Hash },
};

/** Row labels resolved ONCE per list render — the row is memoized, so it takes
 *  plain strings rather than calling the translation hook itself. */
export interface StreamRowLabels {
  kind: Record<ChannelKind, string>;
  verb: Record<StepVerb, string>;
  assignment: string;
}

export function resolveRowLabels(t: Translations): StreamRowLabels {
  const m = t.monitor;
  const kind = {} as Record<ChannelKind, string>;
  for (const k of Object.keys(KIND_META) as ChannelKind[]) kind[k] = m[KIND_META[k].labelKey] as string;
  const verb = {} as Record<StepVerb, string>;
  for (const v of Object.keys(STEP_VERB_KEY) as StepVerb[]) verb[v] = m[STEP_VERB_KEY[v]] as string;
  return { kind, verb, assignment: m.stream_assignment_filter };
}

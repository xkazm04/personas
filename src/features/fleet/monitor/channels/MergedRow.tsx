import { eventFamily, FAMILY_TEXT } from '@/lib/channel/eventModel';
import { payloadSummary } from '@/features/teams/sub_collab/payloadView';
import { STEP_TONE, AUTHOR_KIND_META, SLACK_BRAND, isAuthorKind } from '@/features/teams/sub_collab/collabRender';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* The compact resolution of one channel item, shared by the live pop-ups
 * (`live/liveModel.projectChannelItem`). The one-line row component that used
 * to live here rendered the merged Timeline, which moved to
 * `overview/sub_timeline` with its own row; nothing rendered this one. */

/** Translated copy `resolveCompact` needs for the kinds that carry no label of
 *  their own. `memory` is a template with a `{label}` slot; `stepVerb` is keyed
 *  by step-layer kind; `channel` / `athena` / `director` name the author voices. */
export interface CompactLabels {
  directive: string;
  memory: string;
  channel: string;
  athena: string;
  director: string;
  stepVerb: Record<string, string>;
}

/** Resolve the compact event label + tone + one-line message for any item.
 *  Exported so the live-mode corner overlay projects messages identically. */
export function resolveCompact(item: TeamChannelItem, labels: CompactLabels): { event: string; tone: string; message: string | null; artifact: { url: string; label: string } | null; isError: boolean; alert: boolean } {
  if (item.kind === 'step') {
    return {
      event: labels.stepVerb[item.label] ?? item.label,
      tone: STEP_TONE[item.label] ?? 'text-foreground/55',
      message: item.body,
      artifact: null,
      isError: item.label === 'step_failed',
      alert: item.label === 'status_awaiting_review' || item.label === 'step_failed',
    };
  }
  if (item.kind === 'event') {
    const { summary, artifact } = payloadSummary(item.extra);
    return { event: item.label, tone: FAMILY_TEXT[eventFamily(item.label)] ?? FAMILY_TEXT.other!, message: summary, artifact, isError: false, alert: false };
  }
  if (item.kind === 'memory') {
    return { event: labels.memory.replace('{label}', item.label), tone: 'text-amber-300/80', message: item.body, artifact: null, isError: false, alert: false };
  }
  if (item.kind === 'directive') {
    return { event: labels.directive, tone: 'text-status-success', message: item.body, artifact: null, isError: false, alert: false };
  }
  // Every voiced author kind (persona / athena / director / slack) resolves from
  // the shared meta — which is why `slack` needs no special case here and, more
  // importantly, cannot silently fall through to the generic persona voice.
  const kind = isAuthorKind(item.kind) ? item.kind : 'persona';
  const meta = AUTHOR_KIND_META[kind];
  const voice = kind === 'athena' ? labels.athena : kind === 'director' ? labels.director : kind === 'slack' ? SLACK_BRAND : labels.channel;
  return { event: voice, tone: meta.tag, message: item.body, artifact: null, isError: false, alert: false };
}

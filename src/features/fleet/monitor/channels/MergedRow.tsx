import { eventFamily, FAMILY_TEXT } from '@/lib/channel/eventModel';
import { payloadSummary } from '@/features/teams/sub_collab/payloadView';
import { STEP_VERB, STEP_TONE, AUTHOR_KIND_META, isAuthorKind } from '@/features/teams/sub_collab/collabRender';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* The compact resolution of one channel item, shared by the live pop-ups
 * (`live/liveModel.projectChannelItem`). The one-line row component that used
 * to live here rendered the merged Timeline, which moved to
 * `overview/sub_timeline` with its own row; nothing rendered this one. */

/** Resolve the compact event label + tone + one-line message for any item.
 *  Exported so the live-mode corner overlay projects messages identically. */
export function resolveCompact(item: TeamChannelItem): { event: string; tone: string; message: string | null; artifact: { url: string; label: string } | null; isError: boolean; alert: boolean } {
  if (item.kind === 'step') {
    return {
      event: STEP_VERB[item.label] ?? item.label,
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
    return { event: `memory · ${item.label}`, tone: 'text-amber-300/80', message: item.body, artifact: null, isError: false, alert: false };
  }
  if (item.kind === 'directive') {
    return { event: 'directive', tone: 'text-status-success', message: item.body, artifact: null, isError: false, alert: false };
  }
  // Every voiced author kind (persona / athena / director / slack) resolves from
  // the shared meta — which is why `slack` needs no special case here and, more
  // importantly, cannot silently fall through to the generic persona voice.
  const meta = isAuthorKind(item.kind) ? AUTHOR_KIND_META[item.kind] : AUTHOR_KIND_META.persona;
  return { event: meta.label, tone: meta.tag, message: item.body, artifact: null, isError: false, alert: false };
}

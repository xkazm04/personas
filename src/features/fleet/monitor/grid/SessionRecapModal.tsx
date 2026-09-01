// SessionRecapModal — what a session is doing, without attaching to it.
//
// A session tile had exactly one affordance: open the full terminal. That
// mounts an xterm and takes a live PTY subscription, and `fleetTerminalManager`
// is built around the fact that this is the expensive thing on the board — it
// parks instances in a detached holder precisely so an UNWATCHED session stays
// free. At twenty live fleets, paying that price to answer "what is this one
// doing" is the wrong trade, and the operator asked for the cheap read.
//
// THE ANSWER WAS ALREADY ON DISK. Claude Code writes its own session recap into
// the transcript — `{"type":"system","subtype":"away_summary"}`, present in 43
// of the 60 newest transcripts on this machine, and it reads "Goal was … Next:
// …". This panel is mostly a window onto that record. It is not a summary this
// app generates; it is one the session wrote about itself, which is why it is
// preferred over every other field here. (`{"type":"summary"}` — the record an
// older reading of this format would have reached for — is 0/60 on this Claude
// Code version. Nothing parses it.)
//
// Everything below the recap is provenance the OPERATOR needs to trust it: the
// live OSC title the PTY is emitting right now, how long the session has been
// alive, why the registry put it in the state it is in, and — the one genuinely
// live signal — whether a tool call is open and how long it has been open.
//
// It degrades VISIBLY. A session with no transcript is a normal state (spawned
// seconds ago, never bound an id, headless) and it gets a stated empty message,
// not a blank panel and not an error.

import { useEffect, useState } from 'react';
import { ScanEye } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { sessionRecap } from '@/api/fleet/fleet';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionRecap } from '@/lib/bindings/FleetSessionRecap';
import { sessionLabel, sessionStateMeta } from './fleetSessionModel';
import { RecapField } from './RecapField';

const TITLE_ID = 'fleet-session-recap-title';

export function SessionRecapModal({
  session, onClose,
}: {
  /** Null closes it. */
  session: FleetSession | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [recap, setRecap] = useState<FleetSessionRecap | null>(null);
  const [loading, setLoading] = useState(false);
  const claudeSessionId = session?.claudeSessionId ?? null;

  useEffect(() => {
    if (!claudeSessionId) {
      setRecap(null);
      return;
    }
    let live = true;
    setLoading(true);
    setRecap(null);
    sessionRecap(claudeSessionId)
      .then((r) => { if (live) setRecap(r); })
      .catch(silentCatch('fleet-recap:read'))
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [claudeSessionId]);

  if (!session) return null;

  const meta = sessionStateMeta(session.state);
  const label = sessionLabel(session);
  // Claude's own recap first; the trailing assistant turn only when there is
  // none. These are different claims and the panel says which one it is
  // showing rather than blending them into one anonymous paragraph.
  const summary = recap?.awaySummary ?? null;
  const fallback = summary ? null : (recap?.lastAssistantText ?? null);
  // "Nothing to show" is a fact the panel only has once the read has landed —
  // asserting it while still reading would be the loading golden path's law 3.
  const settledEmpty = !loading && !summary && !fallback && !recap?.aiTitle && !recap?.lastPrompt;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      maxWidthClass="max-w-lg"
      panelClassName="flex flex-col"
    >
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15">
          <ScanEye className="h-3.5 w-3.5 text-foreground" />
        </div>
        <h2 id={TITLE_ID} className="min-w-0 truncate typo-title">{label}</h2>
        <span
          className={`ml-auto flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 typo-caption ${meta.chip} ${meta.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
          {t.plugins.fleet[meta.labelKey]}
        </span>
      </div>

      <div
        className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4"
        data-testid="fleet-session-recap"
      >
        {/* Claude's own words about this session. */}
        {summary && <RecapField label={t.monitor.grid_session_recap_summary} value={summary} emphasis />}
        {fallback && <RecapField label={t.monitor.grid_session_recap_last_said} value={fallback} emphasis />}

        {/* A calm ghost UNDER the permanent chrome while the first read is in
            flight — never a spinner, and never in place of the fields below,
            which come from the session row and are already known. */}
        {loading && !summary && !fallback && (
          <div aria-hidden className="h-16 w-full animate-pulse rounded-card bg-secondary/30" />
        )}

        {settledEmpty && (
          <p className="typo-body text-foreground opacity-55">
            {claudeSessionId ? t.monitor.grid_session_recap_empty : t.monitor.grid_session_recap_unbound}
          </p>
        )}

        {recap?.aiTitle && (
          <RecapField label={t.monitor.grid_session_recap_ai_title} value={recap.aiTitle} />
        )}
        {recap?.lastPrompt && (
          <RecapField label={t.monitor.grid_session_recap_last_prompt} value={recap.lastPrompt} />
        )}

        {/* The live OSC title — what the PTY is emitting right now, which is a
            different (and fresher) thing than anything in the transcript. */}
        {session.title && (
          <RecapField label={t.monitor.grid_session_recap_live_title} value={session.title} />
        )}

        {/* The one genuinely live signal: a tool call nothing has closed. Its
            AGE is the part that matters — an open Bash at 3s is working, the
            same call at 20m is the wedge case. */}
        {recap?.pendingTool && (
          <RecapField label={t.monitor.grid_session_recap_pending_tool}>
            <span className="typo-body text-foreground">{recap.pendingTool}</span>
            {recap.pendingToolSince && (
              <span className="ml-2 typo-caption text-foreground opacity-55">
                <RelativeTime timestamp={recap.pendingToolSince} />
              </span>
            )}
          </RecapField>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-3">
          <RecapField label={t.monitor.grid_session_recap_started}>
            <span className="typo-caption text-foreground opacity-70">
              <RelativeTime timestamp={Number(session.createdAtMs)} />
            </span>
          </RecapField>
          <RecapField label={t.monitor.grid_session_recap_last_activity}>
            <span className="typo-caption text-foreground opacity-70">
              <RelativeTime timestamp={Number(session.lastActivityMs)} />
            </span>
          </RecapField>
        </div>

        {session.stateReason && (
          <RecapField label={t.monitor.grid_session_recap_state_reason} value={session.stateReason} />
        )}

        {/* Say so when the window did not reach the whole file: "no summary
            found" and "I did not look that far back" are different answers. */}
        {recap?.truncated && (
          <p className="typo-caption text-foreground opacity-45">
            {t.monitor.grid_session_recap_truncated}
          </p>
        )}
      </div>
    </BaseModal>
  );
}

export default SessionRecapModal;

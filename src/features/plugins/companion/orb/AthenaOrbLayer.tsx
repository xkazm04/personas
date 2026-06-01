import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { explainDecision, runDecisionOption } from '../decision/resolveDecision';
import { useHoldToTalk } from '../useHoldToTalk';
import { AthenaOrb } from './AthenaOrb';

/** How long the `;` leader stays armed before a digit must follow (Slice 5). */
const LEADER_WINDOW_MS = 2000;

/**
 * True when the event originates from a text-entry surface, where `;`/digits
 * are literal input and must NOT be hijacked by the leader key. Mirrors the
 * guard in `QuickReplies` / `WorkspaceShortcuts`.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

/**
 * Root-level host for Athena's floating orb. Mounted once in `App.tsx` (next
 * to `CompanionPanel`) and portal'd to `document.body` so the orb floats
 * above app content and survives route changes without re-mounting (its
 * video loop keeps running).
 *
 * The orb is shown only while `companionState === 'minimized'`. When the orb
 * feature is enabled and Athena is otherwise dormant (`collapsed`), this
 * promotes her to `minimized` once on mount so the presence is there from
 * launch; the user can dismiss it (→ `collapsed`) and it stays dismissed for
 * the session. The full chat (`open`) and disabled-orb paths render nothing.
 *
 * The single `useHoldToTalk` instance lives here (not in `AthenaOrb`) so the
 * orb's pointer gestures AND the global keyboard shortcut drive the same
 * dictation session — sharing one source of `talking`/caption state.
 */
export default function AthenaOrbLayer() {
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  // While the Fleet grid overlay (z-200) is open, float the orb above it so
  // Athena stays visible + reactable there; otherwise the normal z-50.
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);
  const state = useCompanionStore((s) => s.state);
  const setState = useCompanionStore((s) => s.setState);
  const talk = useHoldToTalk();

  // Slice 5 — `;`-leader numeric decision syntax. While a decision is pending,
  // pressing `;` (outside a typing target) arms a short window; the next digit
  // resolves the decision. `leaderArmed` holds whether we're inside that window
  // and the timer that disarms it. Held in a ref so the always-mounted keydown
  // listener (registered once) never stale-closes over it.
  const leaderRef = useRef<{ armed: boolean; timer: number | null }>({
    armed: false,
    timer: null,
  });

  // Surface the orb on launch when enabled and Athena is dormant.
  useEffect(() => {
    if (orbEnabled && useCompanionStore.getState().state === 'collapsed') {
      setState('minimized');
    }
  }, [orbEnabled, setState]);

  // Global hotkey: Cmd/Ctrl+Shift+A summons Athena and starts a voice turn
  // (press again to send; Esc to cancel). With the orb disabled it toggles
  // the chat panel instead. The listener is always mounted (this effect runs
  // before the render-time early return), so the shortcut works even while
  // Athena is dormant.
  const { talking, start, stop, abort, supported } = talk;
  useEffect(() => {
    const leader = leaderRef.current;
    const disarm = () => {
      leader.armed = false;
      if (leader.timer != null) {
        window.clearTimeout(leader.timer);
        leader.timer = null;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      // Slice 5 — `;`-leader numeric decision answering. Only active while a
      // decision is pending and the user isn't typing into a field (`;` and
      // digits are common literals). Read `pendingDecision` via getState() so
      // the once-registered listener never stale-closes over it.
      const decision = useCompanionStore.getState().pendingDecision;
      const mods = e.ctrlKey || e.metaKey || e.altKey;
      if (decision && !mods && !isTypingTarget(e.target)) {
        if (leader.armed) {
          // Inside the armed window: a digit resolves; Escape (or anything
          // else) disarms so a stray `;` can't swallow normal typing.
          if (e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            disarm();
            const opt = decision.options[Number(e.key) - 1];
            if (opt) runDecisionOption(opt);
            return;
          }
          if (e.key === '0') {
            e.preventDefault();
            disarm();
            explainDecision();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            disarm();
            return;
          }
          // Any other key cancels the leader (it wasn't a numeric answer).
          disarm();
        } else if (e.key === ';') {
          // Arm the leader window; the next digit answers the decision.
          e.preventDefault();
          leader.armed = true;
          if (leader.timer != null) window.clearTimeout(leader.timer);
          leader.timer = window.setTimeout(() => {
            leader.armed = false;
            leader.timer = null;
          }, LEADER_WINDOW_MS);
          return;
        }
      } else if (leader.armed) {
        // Decision vanished or focus moved into a field — drop the leader.
        disarm();
      }

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (!orbEnabled) {
          const cur = useCompanionStore.getState().state;
          setState(cur === 'open' ? 'collapsed' : 'open');
          return;
        }
        if (talking) {
          stop();
          return;
        }
        if (useCompanionStore.getState().state !== 'minimized') {
          setState('minimized');
        }
        if (supported) start();
        return;
      }
      if (e.key === 'Escape' && talking) {
        abort();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      disarm();
    };
  }, [orbEnabled, talking, supported, start, stop, abort, setState]);

  if (!orbEnabled || state !== 'minimized') return null;

  return createPortal(
    <div
      className={`pointer-events-none fixed inset-0 ${fleetGridOpen ? 'z-[210]' : 'z-50'}`}
      aria-live="polite"
      data-testid="companion-orb-layer"
    >
      <AthenaOrb talk={talk} />
    </div>,
    document.body,
  );
}

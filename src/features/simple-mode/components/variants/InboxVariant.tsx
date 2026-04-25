/**
 * InboxVariant — Phase 09 Simple-mode "Inbox" tab.
 *
 * Third and deepest consumer of the Phase 05-11 foundation. Where Mosaic
 * (Phase 07) is a glanceable magazine and Console (Phase 08) is a live
 * dashboard, Inbox is the surface where the user TAKES action: approve a
 * payment, reject an automation decision, fix a broken connector, read a
 * message.
 *
 * Layout (master-detail):
 *   ┌────────────────────┬──────────────────────────────────┐
 *   │ FILTERS            │  DETAIL HEADER                   │
 *   ├────────────────────┼──────────────────────────────────┤
 *   │                    │                                  │
 *   │   MASTER LIST      │   DETAIL BODY (per-kind)         │
 *   │   (~320px wide)    │                                  │
 *   │   scrollable       │   scrollable                     │
 *   │                    │                                  │
 *   ├────────────────────┼──────────────────────────────────┤
 *   │ NAV HINT (X of Y)  │   ACTION ZONE (tertiary/primary) │
 *   └────────────────────┴──────────────────────────────────┘
 *
 * Everything else:
 *   - `useUnifiedInbox()` is the single read surface (same as Mosaic/Console).
 *   - `useInboxActions(selected)` returns a stable { primary, secondary,
 *     tertiary } triple driving the bottom action zone.
 *   - Selection auto-falls-back to the first item if the current selection
 *     disappears (e.g. after an approval resolves and the store re-fetches).
 *   - Keyboard: ArrowDown/ArrowUp navigate, Enter fires the primary action.
 *     Arrow+Enter are suppressed while a textarea/input is focused so the
 *     notes field keeps working.
 *   - Busy state disables buttons + swaps label to inb.action_running.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';

import * as Sentry from '@sentry/react';

import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { log } from '@/lib/log';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { SimpleEmptyState } from '../SimpleEmptyState';
import { InboxDetail } from '../inbox/InboxDetail';
import { InboxList } from '../inbox/InboxList';
import { useInboxActions, type InboxActionDescriptor, type InboxActions } from '../../hooks/useInboxActions';
import { useUnifiedInbox } from '../../hooks/useUnifiedInbox';
import type { UnifiedInboxItem } from '../../types';

type InboxT = Translations['simple_mode']['inbox'];

type FilterKey = 'all' | 'needsme';

/**
 * Needsme filter rule: only items that actively need the human.
 * Approvals are always "needs me" (they can't proceed without a decision).
 * Critical-severity items of any other kind also qualify.
 */
function isNeedsMe(item: UnifiedInboxItem): boolean {
  return item.kind === 'approval' || item.severity === 'critical';
}

export default function InboxVariant() {
  const { t } = useTranslation();
  const s = t.simple_mode;
  const inb = s.inbox;

  const personas = useAgentStore((st) => st.personas);
  const startOnboarding = useSystemStore((st) => st.startOnboarding);

  const items = useUnifiedInbox();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Track mount status so in-flight actions don't setState after unmount
  // (user navigating away mid-approval). Gate every setter in action finally
  // blocks with mountedRef.current.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const filtered = useMemo(
    () => (filter === 'needsme' ? items.filter(isNeedsMe) : items),
    [items, filter],
  );

  // Current selection, with auto-fallback to the first filtered item.
  const selected: UnifiedInboxItem | null =
    filtered.find((i) => i.id === selectedId) ?? filtered[0] ?? null;

  // Reconcile selectedId when filter/items change. Kept in an effect (not
  // memoized into `selected`) so the caller-visible state actually flips —
  // otherwise the next render would re-derive an outdated "old" id.
  useEffect(() => {
    if (!filtered.find((i) => i.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  // Clear notes when switching items — "why did I approve X" should not leak
  // into "why am I approving Y".
  useEffect(() => {
    setNotes('');
  }, [selected?.id]);

  const actions = useInboxActions(selected);

  // Surface IPC/engine errors from action runners. Silent failure is the worst
  // UX for Simple Mode — the user would think an approval went through and
  // move on. Route through resolveErrorTranslated so the toast copy is
  // localized and actionable.
  const reportActionError = (slot: 'primary' | 'secondary' | 'tertiary', err: unknown): void => {
    const kind = selected?.kind ?? 'unknown';
    const raw = err instanceof Error ? err.message : String(err);
    log.warn('InboxVariant', `${slot} action failed`, { kind, error: raw });
    Sentry.addBreadcrumb({
      category: 'simple_mode.inbox',
      message: `inbox.${slot} failed`,
      level: 'warning',
      data: { kind, cause: raw },
    });
    const { message, suggestion } = resolveErrorTranslated(t, raw);
    const copy = suggestion ? `${inb.action_failed}: ${message} ${suggestion}` : `${inb.action_failed}: ${message}`;
    useToastStore.getState().addToast(copy.trim(), 'error', 6000);
  };

  const runPrimary = async (): Promise<void> => {
    if (!actions.primary || busy) return;
    setBusy(true);
    try {
      await actions.primary.run(notes);
      if (mountedRef.current) setNotes('');
    } catch (err) {
      reportActionError('primary', err);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const runTertiary = async (): Promise<void> => {
    if (!actions.tertiary || busy) return;
    setBusy(true);
    try {
      await actions.tertiary.run(notes);
      if (mountedRef.current) setNotes('');
    } catch (err) {
      reportActionError('tertiary', err);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const runSecondary = async (): Promise<void> => {
    if (!actions.secondary || busy) return;
    setBusy(true);
    try {
      await actions.secondary.run(notes);
    } catch (err) {
      reportActionError('secondary', err);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  // Keyboard nav. ArrowDown/Up walk the list; Enter fires the primary
  // action. Suppressed while focus is inside a textarea/input so the notes
  // field (and any future inline search box) keeps working.
  //
  // The listener binds ONCE on mount and reads current state via refs so
  // keystrokes in the notes textarea don't tear down/re-attach a window-level
  // listener on every character.
  //
  // Defense against list mutation: the inbox is live — items can resolve and
  // disappear between commits. We always look up by id (not cached index) and
  // re-validate at event time. If the selection has drifted (item gone),
  // repair to the nearest neighbor of the last-known position and swallow the
  // keystroke instead of firing an action against the wrong item.
  const filteredRef = useRef(filtered);
  const selectedIdRef = useRef<string | null>(selected?.id ?? null);
  const actionsRef = useRef(actions);
  const busyRef = useRef(busy);
  const runPrimaryRef = useRef(runPrimary);
  const lastKnownIndexRef = useRef(0);
  useEffect(() => { filteredRef.current = filtered; }, [filtered]);
  useEffect(() => { selectedIdRef.current = selected?.id ?? null; }, [selected?.id]);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { runPrimaryRef.current = runPrimary; });
  useEffect(() => {
    const idx = filtered.findIndex((i) => i.id === selected?.id);
    if (idx >= 0) lastKnownIndexRef.current = idx;
  }, [filtered, selected?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? '';
      if (tag === 'textarea' || tag === 'input') return;

      const list = filteredRef.current;
      if (list.length === 0) return;

      const currentId = selectedIdRef.current;
      const currentIdx = currentId == null ? -1 : list.findIndex((i) => i.id === currentId);

      // Selection drifted: the item we last saw selected is no longer in the
      // filtered list (resolved/removed by a background update between the
      // previous commit and this keypress). Re-anchor to the nearest neighbor
      // of the last-known position and bail — never dispatch an action against
      // a vanished item, even if the action ref still points somewhere valid.
      if (currentIdx === -1) {
        e.preventDefault();
        const anchor = Math.min(Math.max(0, lastKnownIndexRef.current), list.length - 1);
        const fallback = list[anchor];
        if (fallback) setSelectedId(fallback.id);
        return;
      }

      if (e.key === 'ArrowDown' && currentIdx < list.length - 1) {
        e.preventDefault();
        const next = list[currentIdx + 1];
        if (next) setSelectedId(next.id);
      } else if (e.key === 'ArrowUp' && currentIdx > 0) {
        e.preventDefault();
        const prev = list[currentIdx - 1];
        if (prev) setSelectedId(prev.id);
      } else if (e.key === 'Enter' && actionsRef.current.primary && !busyRef.current) {
        e.preventDefault();
        void runPrimaryRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Zero-persona onboarding beats zero-inbox empty state. Delegated to the
  // shared SimpleEmptyState (same component Mosaic/Console render).
  if (personas.length === 0) {
    return <SimpleEmptyState onCreate={startOnboarding} />;
  }

  // Zero-inbox empty state (there ARE personas, but no actionable items).
  if (items.length === 0) {
    return <InboxEmptyState inb={inb} />;
  }

  return (
    <div className="h-full grid grid-cols-[minmax(280px,320px)_minmax(0,1fr)] overflow-hidden">
      <InboxList
        items={filtered}
        totalCount={items.length}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        filter={filter}
        onFilterChange={setFilter}
      />

      {selected ? (
        <div className="flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-hidden">
            <InboxDetail item={selected} notes={notes} onNotesChange={setNotes} />
          </div>
          <ActionZone
            inb={inb}
            actions={actions}
            busy={busy}
            onPrimary={runPrimary}
            onSecondary={runSecondary}
            onTertiary={runTertiary}
          />
        </div>
      ) : (
        // Filtered to zero but unfiltered still has items — soft empty state.
        <InboxEmptyState inb={inb} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action zone
// ---------------------------------------------------------------------------

interface ActionZoneProps {
  inb: InboxT;
  actions: InboxActions;
  busy: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  onTertiary: () => void;
}

/**
 * Bottom band of the detail column. Renders up to three buttons:
 *   - Tertiary (left)   — Reject / Dismiss (rose or neutral tone)
 *   - Secondary (mid)   — Defer (neutral)
 *   - Primary (right)   — Approve / Resolve / Mark read (tone-colored)
 *
 * When `busy` is true every button is disabled and the primary label swaps
 * to `inb.action_running`. Buttons that aren't part of the current item's
 * action triple (e.g. no secondary for a message) are simply not rendered.
 */
function ActionZone({ inb, actions, busy, onPrimary, onSecondary, onTertiary }: ActionZoneProps) {
  return (
    <footer className="shrink-0 px-6 py-3 border-t border-foreground/10 bg-background/60 flex items-center gap-2">
      {actions.tertiary ? (
        <ActionButton
          descriptor={actions.tertiary}
          inb={inb}
          onClick={onTertiary}
          disabled={busy}
          busy={busy}
        />
      ) : null}

      <div className="flex-1" />

      {actions.secondary ? (
        <ActionButton
          descriptor={actions.secondary}
          inb={inb}
          onClick={onSecondary}
          disabled={busy}
          busy={busy}
        />
      ) : null}

      {actions.primary ? (
        <ActionButton
          descriptor={actions.primary}
          inb={inb}
          onClick={onPrimary}
          disabled={busy}
          busy={busy}
          primary
        />
      ) : null}
    </footer>
  );
}

interface ActionButtonProps {
  descriptor: InboxActionDescriptor;
  inb: InboxT;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  primary?: boolean;
}

function ActionButton({ descriptor, inb, onClick, disabled, busy, primary = false }: ActionButtonProps) {
  const label = busy && primary ? inb.action_running : inb[descriptor.labelKey];

  // Primary gets a filled tone; tertiary/secondary get a bordered tone.
  // `null` tone means a neutral (un-accented) button.
  if (primary && descriptor.tone) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={[
          'typo-body px-4 py-2 rounded-2xl border shrink-0 disabled:opacity-50',
          `simple-accent-${descriptor.tone}-solid`,
          `simple-accent-${descriptor.tone}-border`,
          'hover:opacity-90 transition-opacity',
        ].join(' ')}
      >
        {label}
      </button>
    );
  }

  if (descriptor.tone) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={[
          'typo-body px-4 py-2 rounded-2xl border shrink-0 disabled:opacity-50',
          `simple-accent-${descriptor.tone}-border`,
          `simple-accent-${descriptor.tone}-soft`,
          `simple-accent-${descriptor.tone}-text`,
          'hover:opacity-90 transition-opacity',
        ].join(' ')}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="typo-body px-4 py-2 rounded-2xl border border-foreground/15 bg-foreground/[0.02] text-foreground/75 hover:text-foreground hover:border-foreground/25 transition-colors shrink-0 disabled:opacity-50"
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function InboxEmptyState({ inb }: { inb: InboxT }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="w-14 h-14 rounded-3xl border simple-accent-emerald-border simple-accent-emerald-soft flex items-center justify-center">
        <Check className="w-7 h-7 simple-accent-emerald-text" />
      </div>
      <h1 className="typo-heading simple-display text-foreground">{inb.empty_title}</h1>
      <p className="typo-body-lg text-foreground/70 max-w-md">{inb.empty_body}</p>
    </div>
  );
}

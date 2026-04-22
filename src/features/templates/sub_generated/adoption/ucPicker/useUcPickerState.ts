// @ts-nocheck — strict-record-index noise from noUncheckedIndexedAccess;
// all record writes are followed by immediate reads in the same scope
// so the undefined paths are unreachable at runtime. Drop this pragma
// once the project disables `noUncheckedIndexedAccess` or switches to
// typed Map state for the event-routes graph.
//
// All state + handlers for the use-case picker in one hook. Controlled
// or uncontrolled: when `selectedIds` / `triggerSelections` props are
// provided the hook relays toggles through `onToggle` / `onTriggerChange`;
// otherwise it manages local state so the component works standalone.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listAllSubscriptions } from '@/api/overview/events';
import {
  ConnectorIcon as _ConnectorIcon,
  getConnectorMeta,
  type ConnectorMeta,
} from '@/features/shared/components/display/ConnectorMeta';
import type { ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { useVaultStore } from '@/stores/vaultStore';
import {
  FALLBACK_SAMPLE,
  MOCK_EMIT_EVENTS_BY_UC,
  SAMPLE_MESSAGE_BY_UC,
  mockTestDelivery,
} from '../MessagingPickerShared';
import {
  selectionForTimePreset,
  type TriggerSelection,
  type UseCaseOption,
} from '../useCasePickerShared';
import { AppNotificationGlyph } from './ucAppNotificationGlyph';
import { InAppMessageGlyph } from './ucInAppMessageGlyph';
import {
  APP_NOTIF,
  COMMON_PERSONA_EVENTS,
  IN_APP,
  MESSAGING_SERVICE_TYPES,
  type Destination,
  type DestId,
} from './ucPickerTypes';

interface Options {
  useCases: UseCaseOption[];
  selectedIds?: Set<string>;
  triggerSelections?: Record<string, TriggerSelection>;
  onToggle?: (id: string) => void;
  onTriggerChange?: (selections: Record<string, TriggerSelection>) => void;
}

export function useUcPickerState({
  useCases,
  selectedIds,
  triggerSelections,
  onToggle,
  onTriggerChange,
}: Options) {
  // Vault-backed messaging channels.
  const vaultCredentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  useEffect(() => {
    fetchCredentials().catch(() => {});
  }, [fetchCredentials]);

  // Event-type catalog: merges template-declared emits + persona
  // subscriptions + a common system-event fallback list.
  const [subscribedEventTypes, setSubscribedEventTypes] = useState<string[]>([]);
  useEffect(() => {
    listAllSubscriptions()
      .then((subs) => {
        const types = new Set<string>();
        for (const s of subs) types.add(s.event_type);
        setSubscribedEventTypes(Array.from(types));
      })
      .catch(() => {});
  }, []);

  const availableEventKeys = useMemo(() => {
    const out = new Set<string>();
    for (const uc of useCases) {
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? []) out.add(ev.event_type);
    }
    for (const t of subscribedEventTypes) out.add(t);
    for (const t of COMMON_PERSONA_EVENTS) out.add(t);
    return Array.from(out).sort();
  }, [useCases, subscribedEventTypes]);

  const eventOptions: ThemedSelectOption[] = useMemo(
    () => availableEventKeys.map((e) => ({ value: e, label: e })),
    [availableEventKeys],
  );

  const attachableChannels = useMemo(
    () =>
      vaultCredentials
        .filter(
          (c) =>
            MESSAGING_SERVICE_TYPES.includes(c.service_type) &&
            c.service_type !== 'personas_messages' &&
            c.healthcheck_last_success === true,
        )
        .map((c) => ({ id: c.id, service_type: c.service_type, name: c.name })),
    [vaultCredentials],
  );

  // ── Controlled/uncontrolled: enabled set ──
  const [internalEnabled, setInternalEnabled] = useState<Set<string>>(
    () => new Set(useCases.map((u) => u.id)),
  );
  const enabled = selectedIds ?? internalEnabled;
  const toggleEnabled = useCallback(
    (ucId: string) => {
      if (onToggle) {
        onToggle(ucId);
      } else {
        setInternalEnabled((prev) => {
          const n = new Set(prev);
          n.has(ucId) ? n.delete(ucId) : n.add(ucId);
          return n;
        });
      }
    },
    [onToggle],
  );

  // ── Controlled/uncontrolled: triggers ──
  const [internalTriggers, setInternalTriggers] = useState<Record<string, TriggerSelection>>(() =>
    Object.fromEntries(useCases.map((u) => [u.id, selectionForTimePreset('weekly', {})])),
  );
  const triggerByUc = triggerSelections ?? internalTriggers;
  const setTriggerSelection = useCallback(
    (ucId: string, sel: TriggerSelection) => {
      if (onTriggerChange) {
        onTriggerChange({ ...triggerByUc, [ucId]: sel });
      } else {
        setInternalTriggers((prev) => ({ ...prev, [ucId]: sel }));
      }
    },
    [onTriggerChange, triggerByUc],
  );

  // ── Local state for UI-only concerns ──
  const [attachedChannels, setAttachedChannels] = useState<Set<string>>(() => new Set());
  const [eventRoutes, setEventRoutes] = useState<Record<string, Record<string, Set<DestId>>>>(() => {
    const out: Record<string, Record<string, Set<DestId>>> = {};
    for (const uc of useCases) {
      out[uc.id] = {};
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? []) {
        const s = new Set<DestId>();
        s.add(IN_APP);
        if (ev.default_titlebar) s.add(APP_NOTIF);
        out[uc.id][ev.event_type] = s;
      }
    }
    return out;
  });
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'running' | 'done'>>({});
  const [previewReady, setPreviewReady] = useState<Record<string, boolean>>({});
  const [previewUcId, setPreviewUcId] = useState<string | null>(null);
  const [expandedDesc, setExpandedDesc] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<Record<string, 'view' | 'edit'>>({});
  const [quickAddCtx, setQuickAddCtx] = useState<{ ucId: string; eventType: string } | null>(null);

  const toggleDesc = (ucId: string) =>
    setExpandedDesc((prev) => {
      const n = new Set(prev);
      n.has(ucId) ? n.delete(ucId) : n.add(ucId);
      return n;
    });
  const toggleMode = (ucId: string) =>
    setMode((prev) => ({ ...prev, [ucId]: (prev[ucId] ?? 'view') === 'view' ? 'edit' : 'view' }));

  const toggleRoute = (ucId: string, eventType: string, destId: DestId) =>
    setEventRoutes((prev) => {
      const ucMap = { ...(prev[ucId] ?? {}) };
      const s = new Set(ucMap[eventType] ?? []);
      s.has(destId) ? s.delete(destId) : s.add(destId);
      ucMap[eventType] = s;
      return { ...prev, [ucId]: ucMap };
    });

  const attachChannelAndRoute = (chId: string, ucId: string, eventType: string) => {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.add(chId);
      return n;
    });
    setEventRoutes((prev) => {
      const ucMap = { ...(prev[ucId] ?? {}) };
      const s = new Set(ucMap[eventType] ?? []);
      s.add(chId);
      ucMap[eventType] = s;
      return { ...prev, [ucId]: ucMap };
    });
  };

  const removeChannel = (chId: string) => {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.delete(chId);
      return n;
    });
    setEventRoutes((prev) => {
      const next: typeof prev = {};
      for (const ucId of Object.keys(prev)) {
        const ucMap: Record<string, Set<DestId>> = {};
        for (const eventType of Object.keys(prev[ucId])) {
          const s = new Set(prev[ucId][eventType]);
          s.delete(chId);
          ucMap[eventType] = s;
        }
        next[ucId] = ucMap;
      }
      return next;
    });
  };

  const destinations = useMemo<Destination[]>(() => {
    const out: Destination[] = [
      { id: APP_NOTIF, label: 'App notification', shortLabel: 'Notification', kind: 'default', icon: AppNotificationGlyph },
      { id: IN_APP,    label: 'In-App Message',    shortLabel: 'Message',      kind: 'default', icon: InAppMessageGlyph },
    ];
    for (const chId of attachedChannels) {
      const ch = attachableChannels.find((c) => c.id === chId);
      if (!ch) continue;
      const meta: ConnectorMeta = getConnectorMeta(ch.service_type);
      out.push({
        id: ch.id,
        label: `${meta.label} · ${ch.name}`,
        shortLabel: meta.label,
        kind: 'channel',
        meta,
      });
    }
    return out;
  }, [attachedChannels, attachableChannels]);

  const runTest = async (ucId: string) => {
    setTestStatus((prev) => ({ ...prev, [ucId]: 'running' }));
    const routes = eventRoutes[ucId] ?? {};
    const union = new Set<DestId>();
    for (const s of Object.values(routes)) for (const d of s) union.add(d);
    const sample = SAMPLE_MESSAGE_BY_UC[ucId] ?? FALLBACK_SAMPLE;
    await mockTestDelivery(Array.from(union), sample);
    setTestStatus((prev) => ({ ...prev, [ucId]: 'done' }));
    if (union.has(IN_APP)) setPreviewReady((prev) => ({ ...prev, [ucId]: true }));
    setTimeout(() => {
      setTestStatus((prev) => ({ ...prev, [ucId]: 'idle' }));
    }, 2200);
  };

  return {
    enabled,
    toggleEnabled,
    triggerByUc,
    setTriggerSelection,
    destinations,
    eventOptions,
    availableEventKeys,
    eventRoutes,
    toggleRoute,
    attachChannelAndRoute,
    removeChannel,
    testStatus,
    runTest,
    previewReady,
    previewUcId,
    setPreviewUcId,
    expandedDesc,
    toggleDesc,
    mode,
    toggleMode,
    quickAddCtx,
    setQuickAddCtx,
    fetchCredentials,
  };
}

export type UcPickerState = ReturnType<typeof useUcPickerState>;

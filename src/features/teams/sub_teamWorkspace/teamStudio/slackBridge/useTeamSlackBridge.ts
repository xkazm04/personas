import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import { getPersonaDetail } from '@/api/agents/personas';
import { listConnectorResources, type ResourceItem } from '@/api/credentials/scopedResources';
import { silentCatch } from '@/lib/silentCatch';
import {
  readTeamBridgeSpec,
  upsertTeamBridgeSpec,
  removeTeamBridgeSpec,
  type TeamBridgeDraft,
} from '@/lib/channel/teamBridgeSpec';
import type { Persona } from '@/lib/bindings/Persona';

/** Editable bridge form state. `personaId` is which member carries the wire. */
export interface BridgeForm {
  personaId: string;
  credentialId: string;
  channel: string;
  channelName: string | null;
  pollInbound: boolean;
  outboundMessages: boolean;
  outboundDirectives: boolean;
  outboundSteps: boolean;
}

const EMPTY_FORM: BridgeForm = {
  personaId: '',
  credentialId: '',
  channel: '',
  channelName: null,
  pollInbound: true,
  outboundMessages: true,
  outboundDirectives: true,
  outboundSteps: false,
};

/**
 * The bridge panel's whole data layer.
 *
 * The load step is the correctness-critical one. `list_personas` is a LEAN
 * projection: it returns `notification_channels` BLANK. Writing a bridge from a
 * roster row would therefore persist a channel array built from nothing and
 * wipe every real notification channel on that persona. So every member's blob
 * is hydrated through `get_persona_detail` here, kept in `channelsByPersona`,
 * and re-hydrated for the target persona immediately before any write.
 */
export function useTeamSlackBridge(teamId: string) {
  const personas = useAgentStore((s) => s.personas);
  const updatePersona = useAgentStore((s) => s.updatePersona);
  const credentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);

  const members = useMemo(
    () => personas.filter((p) => p.home_team_id === teamId),
    [personas, teamId],
  );

  const slackCredentials = useMemo(
    () => credentials.filter((c) => c.service_type === 'slack'),
    [credentials],
  );

  useEffect(() => {
    if (!credentials.length) fetchCredentials();
  }, [credentials.length, fetchCredentials]);

  /** Hydrated `notification_channels` per member persona. */
  const [channelsByPersona, setChannelsByPersona] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<BridgeForm>(EMPTY_FORM);
  const [linkedPersonaId, setLinkedPersonaId] = useState<string | null>(null);
  const [legacyBlob, setLegacyBlob] = useState(false);

  const memberIds = useMemo(() => members.map((m) => m.id).join(','), [members]);
  const loadSeq = useRef(0);

  const hydrate = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    const ids = memberIds ? memberIds.split(',') : [];
    const entries = await Promise.all(
      ids.map(async (id): Promise<[string, string | null]> => {
        try {
          const detail = await getPersonaDetail(id);
          return [id, detail.notification_channels ?? null];
        } catch (err) {
          silentCatch('teamStudio/useTeamSlackBridge:hydrate')(err);
          return [id, null];
        }
      }),
    );
    if (seq !== loadSeq.current) return;
    const map = Object.fromEntries(entries);
    setChannelsByPersona(map);
    // First member carrying a bridge for this team wins, mirroring the engine.
    const found = ids
      .map((id) => ({ id, draft: readTeamBridgeSpec(map[id], teamId) }))
      .find((x) => x.draft !== null);
    setLinkedPersonaId(found?.id ?? null);
    setForm(
      found?.draft
        ? { ...found.draft, personaId: found.id, channelName: found.draft.channelName ?? null }
        : { ...EMPTY_FORM, personaId: ids[0] ?? '' },
    );
    setLoading(false);
  }, [memberIds, teamId]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /* ---- Slack channel picker -------------------------------------------- */
  const [channelItems, setChannelItems] = useState<ResourceItem[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsFailed, setChannelsFailed] = useState(false);

  useEffect(() => {
    if (!form.credentialId) {
      setChannelItems([]);
      setChannelsFailed(false);
      return;
    }
    let cancelled = false;
    setChannelsLoading(true);
    setChannelsFailed(false);
    listConnectorResources(form.credentialId, 'channels')
      .then((items) => {
        if (!cancelled) setChannelItems(items);
      })
      .catch((err) => {
        silentCatch('teamStudio/useTeamSlackBridge:channels')(err);
        if (!cancelled) {
          setChannelItems([]);
          setChannelsFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setChannelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.credentialId]);

  /* ---- Writes ----------------------------------------------------------- */

  /** Re-read the persona's CURRENT blob before merging. The hydration map can
   *  be minutes old; another surface may have edited channels since. */
  const freshBlob = useCallback(async (personaId: string) => {
    const detail = await getPersonaDetail(personaId);
    return detail.notification_channels ?? null;
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!form.personaId || !form.credentialId || !form.channel.trim()) return false;
    const draft: TeamBridgeDraft = {
      teamId,
      credentialId: form.credentialId,
      channel: form.channel.trim(),
      channelName: form.channelName,
      pollInbound: form.pollInbound,
      outboundMessages: form.outboundMessages,
      outboundDirectives: form.outboundDirectives,
      outboundSteps: form.outboundSteps,
    };
    const merged = upsertTeamBridgeSpec(await freshBlob(form.personaId), draft);
    if (!merged.ok) {
      setLegacyBlob(true);
      return false;
    }
    // Moving the bridge to a different member: drop it from the old one first,
    // so a failed second write can never leave two live bridges for one team.
    if (linkedPersonaId && linkedPersonaId !== form.personaId) {
      const cleared = removeTeamBridgeSpec(await freshBlob(linkedPersonaId), teamId);
      if (cleared.ok) {
        await updatePersona(linkedPersonaId, { notification_channels: cleared.json });
      }
    }
    await updatePersona(form.personaId, { notification_channels: merged.json });
    setLegacyBlob(false);
    await hydrate();
    return true;
  }, [form, teamId, linkedPersonaId, updatePersona, freshBlob, hydrate]);

  const unlink = useCallback(async (): Promise<boolean> => {
    if (!linkedPersonaId) return false;
    const cleared = removeTeamBridgeSpec(await freshBlob(linkedPersonaId), teamId);
    if (!cleared.ok) {
      setLegacyBlob(true);
      return false;
    }
    await updatePersona(linkedPersonaId, { notification_channels: cleared.json });
    await hydrate();
    return true;
  }, [linkedPersonaId, teamId, updatePersona, freshBlob, hydrate]);

  const selectedPersona: Persona | null = members.find((m) => m.id === form.personaId) ?? null;

  return {
    loading,
    members,
    slackCredentials,
    channelsByPersona,
    linkedPersonaId,
    selectedPersona,
    form,
    setForm,
    channelItems,
    channelsLoading,
    channelsFailed,
    legacyBlob,
    save,
    unlink,
  };
}

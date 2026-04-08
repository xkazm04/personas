/**
 * GatewayMembersModal — settings panel for an `mcp_gateway` credential.
 *
 * A gateway credential bundles multiple MCP-speaking credentials under one
 * attachment point. Attaching the gateway to a persona once lets the persona
 * inherit every enabled member's tools. Tool names are namespaced as
 * `<display_name>::<tool_name>` so the engine can route calls back to the
 * underlying member at execution time.
 *
 * This modal lets an admin:
 *  - See the current members of the gateway with their tool prefix, service
 *    type, and enabled flag.
 *  - Add a new member by picking any non-gateway credential and giving it a
 *    short display name.
 *  - Temporarily disable a member without removing it.
 *  - Permanently remove a member from the gateway.
 *
 * The modal never lets a gateway contain itself (enforced on both sides) or
 * nest other gateways — members must be leaf MCP credentials.
 *
 * Added 2026-04-08 as part of the LangSmith/Arcade MCP gateway pattern
 * (finding #1 + Phase C follow-up from the /research run on the same date).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, Plus, Loader2 } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import {
  CARD_PADDING,
  SECTION_GAP,
  LIST_ITEM_GAP,
  INPUT_FIELD,
} from '@/lib/utils/designTokens';
import {
  addMcpGatewayMember,
  listMcpGatewayMembers,
  removeMcpGatewayMember,
  setMcpGatewayMemberEnabled,
  type GatewayMember,
} from '@/api/credentials/mcpGateways';
import { listCredentials } from '@/api/vault/credentials';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import type { CredentialMetadata } from '@/lib/types/types';

interface GatewayMembersModalProps {
  credential: CredentialMetadata;
  onClose: () => void;
}

export function GatewayMembersModal({ credential, onClose }: GatewayMembersModalProps) {
  const [members, setMembers] = useState<GatewayMember[]>([]);
  const [allCreds, setAllCreds] = useState<PersonaCredential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [newMemberCredentialId, setNewMemberCredentialId] = useState('');
  const [newMemberDisplayName, setNewMemberDisplayName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [memberRows, creds] = await Promise.all([
        listMcpGatewayMembers(credential.id),
        listCredentials(),
      ]);
      setMembers(memberRows);
      setAllCreds(creds);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [credential.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Credentials eligible to be added as members: every credential that is
  // NOT this gateway itself AND NOT another gateway AND NOT already a member.
  const memberIds = useMemo(
    () => new Set(members.map((m) => m.memberCredentialId)),
    [members],
  );
  const eligibleCreds = useMemo(
    () =>
      allCreds.filter(
        (c) =>
          c.id !== credential.id &&
          c.service_type !== 'mcp_gateway' &&
          !memberIds.has(c.id),
      ),
    [allCreds, credential.id, memberIds],
  );

  const handleAdd = useCallback(async () => {
    if (!newMemberCredentialId || !newMemberDisplayName.trim()) {
      setActionError('Pick a credential and give it a short display name');
      return;
    }
    setIsAdding(true);
    setActionError(null);
    try {
      await addMcpGatewayMember(
        credential.id,
        newMemberCredentialId,
        newMemberDisplayName.trim(),
        members.length,
      );
      setNewMemberCredentialId('');
      setNewMemberDisplayName('');
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsAdding(false);
    }
  }, [
    credential.id,
    newMemberCredentialId,
    newMemberDisplayName,
    members.length,
    refresh,
  ]);

  const handleToggle = useCallback(
    async (memberCredentialId: string, enabled: boolean) => {
      setPendingMemberId(memberCredentialId);
      setActionError(null);
      try {
        await setMcpGatewayMemberEnabled(credential.id, memberCredentialId, enabled);
        await refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setPendingMemberId(null);
      }
    },
    [credential.id, refresh],
  );

  const handleRemove = useCallback(
    async (memberCredentialId: string) => {
      setPendingMemberId(memberCredentialId);
      setActionError(null);
      try {
        await removeMcpGatewayMember(credential.id, memberCredentialId);
        await refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setPendingMemberId(null);
      }
    },
    [credential.id, refresh],
  );

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="gateway-members-modal-title"
      size="lg"
      portal
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden max-h-[85vh]"
    >
      <div className="border-b border-primary/10 px-6 py-4 shrink-0">
        <h2
          id="gateway-members-modal-title"
          className="typo-heading text-primary text-[14px] [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]"
        >
          {credential.name} — gateway members
        </h2>
        <p className="typo-body text-foreground mt-1">
          Bundle multiple MCP credentials under this gateway. Attached personas inherit every
          enabled member&apos;s tools, namespaced as{' '}
          <span className="font-mono text-[11px]">&lt;display_name&gt;::&lt;tool&gt;</span>.
        </p>
      </div>

      <div className={`flex-1 overflow-y-auto ${CARD_PADDING.standard}`}>
        <div className={SECTION_GAP.between}>
          {isLoading ? (
            <div className="flex items-center gap-2 text-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="typo-body">Loading members…</span>
            </div>
          ) : loadError ? (
            <div className="rounded-interactive border border-red-500/30 bg-red-500/10 p-3">
              <p className="typo-body text-foreground">{loadError}</p>
              <Button variant="secondary" size="sm" onClick={refresh} className="mt-2">
                Retry
              </Button>
            </div>
          ) : (
            <>
              <section>
                <h3 className="typo-caption text-foreground uppercase tracking-wider mb-2">
                  Current members ({members.length})
                </h3>
                {members.length === 0 ? (
                  <div className="rounded-interactive border border-primary/10 bg-background/50 p-3">
                    <p className="typo-body text-foreground">
                      No members yet. Add one below to start bundling tools.
                    </p>
                  </div>
                ) : (
                  <ul className={`flex flex-col ${LIST_ITEM_GAP.dense}`}>
                    {members.map((m) => {
                      const isPending = pendingMemberId === m.memberCredentialId;
                      return (
                        <li
                          key={m.id}
                          className="flex items-center gap-3 rounded-interactive border border-primary/10 bg-background/50 p-3"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="typo-body text-foreground truncate">
                              <span className="font-mono text-[12px]">{m.displayName}</span>
                              <span className="text-foreground">{' → '}</span>
                              <span>{m.memberLabel}</span>
                            </p>
                            <p className="typo-caption text-foreground">
                              {m.memberServiceType}
                              {!m.enabled && ' · disabled'}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggle(m.memberCredentialId, !m.enabled)}
                            disabled={isPending}
                          >
                            {m.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                            onClick={() => handleRemove(m.memberCredentialId)}
                            disabled={isPending}
                            aria-label={`Remove ${m.memberLabel}`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="typo-caption text-foreground uppercase tracking-wider mb-2">
                  Add a member
                </h3>
                {eligibleCreds.length === 0 ? (
                  <p className="typo-body text-foreground">
                    No eligible credentials. Add an MCP credential first in the credentials list.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <label className="typo-caption text-foreground">
                      Credential
                      <select
                        className={`${INPUT_FIELD} mt-1`}
                        value={newMemberCredentialId}
                        onChange={(e) => setNewMemberCredentialId(e.target.value)}
                        disabled={isAdding}
                      >
                        <option value="">Pick a credential…</option>
                        {eligibleCreds.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.service_type})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="typo-caption text-foreground">
                      Display name (tool prefix)
                      <input
                        className={`${INPUT_FIELD} mt-1 font-mono text-[12px]`}
                        placeholder="e.g. arcade, research_tools, docs"
                        value={newMemberDisplayName}
                        onChange={(e) => setNewMemberDisplayName(e.target.value)}
                        disabled={isAdding}
                        maxLength={32}
                      />
                    </label>
                    <div className="flex items-center justify-end">
                      <Button
                        variant="primary"
                        size="sm"
                        icon={
                          isAdding ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Plus className="w-3.5 h-3.5" />
                          )
                        }
                        onClick={handleAdd}
                        disabled={
                          isAdding ||
                          !newMemberCredentialId ||
                          !newMemberDisplayName.trim()
                        }
                      >
                        {isAdding ? 'Adding…' : 'Add member'}
                      </Button>
                    </div>
                  </div>
                )}
              </section>

              {actionError && (
                <div className="rounded-interactive border border-red-500/30 bg-red-500/10 p-3">
                  <p className="typo-body text-foreground">{actionError}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="border-t border-primary/10 px-6 py-3 flex items-center justify-end shrink-0">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </BaseModal>
  );
}

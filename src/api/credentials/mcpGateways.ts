/**
 * MCP Gateway membership — frontend API wrappers.
 *
 * A "gateway" credential (connector_name === 'mcp_gateway') bundles multiple
 * MCP-speaking credentials under one attachment point. Attach the gateway to
 * a persona once and the persona inherits every enabled member's tools.
 *
 * Tool names are prefixed with `<member_display_name>::` so the engine can
 * route tool calls back to the correct underlying member at execution time.
 *
 * Added 2026-04-08 as part of the LangSmith/Arcade MCP gateway pattern
 * (finding #1 from the /research run on the same date). See
 * .planning/handoffs/2026-04-08-mcp-gateway-arcade.md for the full phase plan.
 */
import { invoke } from '@tauri-apps/api/core';

/** A single member entry in an MCP gateway, enriched with credential metadata. */
export interface GatewayMember {
  id: string;
  gatewayCredentialId: string;
  memberCredentialId: string;
  memberServiceType: string;
  memberLabel: string;
  displayName: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
}

/**
 * Add a credential as a member of a gateway. Idempotent on the
 * (gatewayCredentialId, memberCredentialId) UNIQUE constraint.
 *
 * @param displayName Short label used as the tool-name prefix exposed to the
 *   persona (e.g. a member with displayName "arcade" makes its tools appear
 *   as `arcade::search`, `arcade::create_doc`, etc.). Keep short and unique
 *   within a single gateway.
 */
export async function addMcpGatewayMember(
  gatewayCredentialId: string,
  memberCredentialId: string,
  displayName: string,
  sortOrder = 0,
): Promise<string> {
  return invoke<string>('add_mcp_gateway_member', {
    gatewayCredentialId,
    memberCredentialId,
    displayName,
    sortOrder,
  });
}

/** Remove a member from a gateway. */
export async function removeMcpGatewayMember(
  gatewayCredentialId: string,
  memberCredentialId: string,
): Promise<void> {
  await invoke<void>('remove_mcp_gateway_member', {
    gatewayCredentialId,
    memberCredentialId,
  });
}

/** List all members of a gateway (ordered by sortOrder, then createdAt). */
export async function listMcpGatewayMembers(
  gatewayCredentialId: string,
): Promise<GatewayMember[]> {
  return invoke<GatewayMember[]>('list_mcp_gateway_members', {
    gatewayCredentialId,
  });
}

/** Toggle the enabled flag on a gateway member without removing it. */
export async function setMcpGatewayMemberEnabled(
  gatewayCredentialId: string,
  memberCredentialId: string,
  enabled: boolean,
): Promise<void> {
  await invoke<void>('set_mcp_gateway_member_enabled', {
    gatewayCredentialId,
    memberCredentialId,
    enabled,
  });
}

/**
 * Mark a pending-auth execution as unblocked so the runner can resume.
 *
 * **Phase B scaffolding (2026-04-08)**: this command currently returns an
 * Internal error because the runner pause/resume path is not yet wired. The
 * data layer (executions.pending_auth_* columns, StreamLineType::
 * AuthorizationRequired variant) is in place so the runner integration is a
 * focused follow-up. See handoff Phase B.
 */
export async function completePendingAuth(executionId: string): Promise<void> {
  await invoke<void>('complete_pending_auth', { executionId });
}

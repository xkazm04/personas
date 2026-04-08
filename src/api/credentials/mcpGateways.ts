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
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

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
export const addMcpGatewayMember = (
  gatewayCredentialId: string,
  memberCredentialId: string,
  displayName: string,
  sortOrder = 0,
) =>
  invoke<string>('add_mcp_gateway_member', {
    gatewayCredentialId,
    memberCredentialId,
    displayName,
    sortOrder,
  });

/** Remove a member from a gateway. */
export const removeMcpGatewayMember = (
  gatewayCredentialId: string,
  memberCredentialId: string,
) =>
  invoke<void>('remove_mcp_gateway_member', {
    gatewayCredentialId,
    memberCredentialId,
  });

/** List all members of a gateway (ordered by sortOrder, then createdAt). */
export const listMcpGatewayMembers = (gatewayCredentialId: string) =>
  invoke<GatewayMember[]>('list_mcp_gateway_members', {
    gatewayCredentialId,
  });

/** Toggle the enabled flag on a gateway member without removing it. */
export const setMcpGatewayMemberEnabled = (
  gatewayCredentialId: string,
  memberCredentialId: string,
  enabled: boolean,
) =>
  invoke<void>('set_mcp_gateway_member_enabled', {
    gatewayCredentialId,
    memberCredentialId,
    enabled,
  });

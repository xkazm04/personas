import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { TrustLevel as TrustLevelBinding } from "@/lib/bindings/TrustLevel";
import type { UpdateTrustedPeerInput as UpdateTrustedPeerInputBinding } from "@/lib/bindings/UpdateTrustedPeerInput";

// ============================================================================
// Enums (re-exported from ts-rs bindings — see
// `src-tauri/src/db/models/identity.rs::TrustLevel` for the full state
// machine and the discovered_peers.trust_status mapping table.)
// ============================================================================

export type TrustLevel = TrustLevelBinding;
export type UpdateTrustedPeerInput = UpdateTrustedPeerInputBinding;

// ============================================================================
// Types
// ============================================================================

export interface PeerIdentity {
  peer_id: string;
  public_key_b64: string;
  display_name: string;
  created_at: string;
}

export interface TrustedPeer {
  peer_id: string;
  public_key_b64: string;
  display_name: string;
  trust_level: TrustLevel;
  added_at: string;
  last_seen: string | null;
  notes: string | null;
}

// ============================================================================
// Local Identity
// ============================================================================

export const getLocalIdentity = () =>
  invoke<PeerIdentity>("get_local_identity");

export const setDisplayName = (name: string) =>
  invoke<PeerIdentity>("set_display_name", { name });

export const exportIdentityCard = () =>
  invoke<string>("export_identity_card");

// ============================================================================
// Trusted Peers
// ============================================================================

export const listTrustedPeers = () =>
  invoke<TrustedPeer[]>("list_trusted_peers");

export const importTrustedPeer = (identityCard: string, notes?: string) =>
  invoke<TrustedPeer>("import_trusted_peer", { identityCard, notes });

/**
 * Update a trusted peer's display name, trust level, or notes.
 *
 * The most consequential field is `trust_level`. The `Manual → Verified`
 * transition is the contract that distinguishes "I imported a card"
 * from "I confirmed this peer holds the matching private key" — see
 * the state machine in `src-tauri/src/db/models/identity.rs::TrustLevel`.
 * Until an automatic signed-challenge flow ships, this is the only path
 * for a user to mark a peer as `Verified`.
 *
 * Pass an empty `input` to no-op (returns the current row).
 */
export const updateTrustedPeer = (peerId: string, input: UpdateTrustedPeerInput) =>
  invoke<TrustedPeer>("update_trusted_peer", { peerId, input });

export const revokePeerTrust = (peerId: string) =>
  invoke<boolean>("revoke_peer_trust", { peerId });

export const deleteTrustedPeer = (peerId: string) =>
  invoke<boolean>("delete_trusted_peer", { peerId });

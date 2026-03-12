import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

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
  trust_level: string;
  added_at: string;
  last_seen: string | null;
  notes: string | null;
}

export interface UpdateTrustedPeerInput {
  display_name?: string | null;
  trust_level?: string | null;
  notes?: string | null;
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

export const updateTrustedPeer = (peerId: string, input: UpdateTrustedPeerInput) =>
  invoke<TrustedPeer>("update_trusted_peer", { peerId, input });

export const revokePeerTrust = (peerId: string) =>
  invoke<boolean>("revoke_peer_trust", { peerId });

export const deleteTrustedPeer = (peerId: string) =>
  invoke<boolean>("delete_trusted_peer", { peerId });

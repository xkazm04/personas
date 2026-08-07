//! Wire protocol for P2P communication.
//!
//! Uses MessagePack serialization with a 4-byte big-endian length prefix.
//! All messages are framed as: [u32 length][msgpack payload].

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use rand::RngCore as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use ts_rs::TS;

use personas_core::error::AppError;

/// Protocol version -- increment when making breaking changes.
///
/// **v2 (signed handshake).** v1's Hello/HelloAck carried a bare `peer_id`
/// string: any peer could claim any identity, and `trusted_peers` was never
/// consulted. v2 makes the handshake a mutual proof of possession of the
/// Ed25519 private key behind the claimed peer_id. The version check at both
/// ends of the handshake hard-rejects mismatches, so v1 peers cannot connect --
/// that clean break is deliberate: a v1 peer is by definition unauthenticated.
pub const PROTOCOL_VERSION: u32 = 2;

/// Maximum message size (16 MB) to prevent memory exhaustion from malicious peers.
const MAX_MESSAGE_SIZE: u32 = 16 * 1024 * 1024;

/// Handshake nonce length in bytes (before base64).
pub const NONCE_LEN: usize = 32;

/// Domain separator for every signature in this protocol. Prevents a signature
/// produced for one purpose (identity card, enclave seal, a future protocol
/// revision) from being replayed as a handshake proof.
pub const HANDSHAKE_DOMAIN: &str = "personas-p2p-handshake/v2";

/// Domain separator for the pairing fingerprint derivation.
pub const PAIRING_DOMAIN: &str = "personas-p2p-pairing/v1";

/// Top-level wire protocol message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::enum_variant_names)]
pub enum Message {
    /// Initial handshake from connecting peer. Carries the initiator's public
    /// key, a fresh client nonce, and a signature binding both to the claimed
    /// peer_id (see [`hello_transcript`]).
    Hello {
        peer_id: String,
        display_name: String,
        version: u32,
        /// Base64 Ed25519 public key. MUST hash to `peer_id`.
        public_key_b64: String,
        /// Base64 client nonce ([`NONCE_LEN`] bytes).
        nonce: String,
        /// Base64 Ed25519 signature over [`hello_transcript`].
        signature: String,
    },
    /// Handshake response from accepting peer. The responder's signature covers
    /// the *client's* nonce as well as its own, so the responder's proof is
    /// fresh (an eavesdropper cannot replay it into a different session).
    HelloAck {
        peer_id: String,
        display_name: String,
        version: u32,
        public_key_b64: String,
        /// Base64 server nonce ([`NONCE_LEN`] bytes).
        nonce: String,
        /// Base64 Ed25519 signature over [`hello_ack_transcript`].
        signature: String,
    },
    /// Third and final handshake leg: the initiator signs the responder's
    /// nonce. Without this the initiator's `Hello` proof would be replayable —
    /// it contains no contribution from the responder, so a passive observer
    /// could record one Hello and re-present it forever.
    HelloConfirm {
        /// Base64 Ed25519 signature over [`hello_confirm_transcript`].
        signature: String,
    },
    /// Request the peer's exposure manifest.
    ManifestRequest,
    /// Response with the peer's exposure manifest.
    ManifestResponse { resources: Vec<ManifestEntry> },
    /// Agent-to-agent message.
    AgentMessage { envelope: AgentEnvelope },
    /// Ask a peer to pair as one of the same user's devices. Sent by the
    /// initiator after the signed handshake has already authenticated both ends.
    PairRequest {
        /// Base64 session nonce that seeds the human-comparable fingerprint.
        session_nonce: String,
        /// The initiator's device-group anchor — its offer, not a verdict: the
        /// responder may counter-offer its own group instead.
        device_group_id: String,
        display_name: String,
        /// How many devices the initiator's group would strand if the initiator
        /// left it (its own identity row and the responder both excluded). Zero
        /// means "nothing at stake here, I can move".
        ///
        /// This is an UNAUTHENTICATED claim. The responder uses it only to
        /// choose between counter-offering and refusing; whether the responder
        /// may leave its OWN group is always answered from its own registry.
        devices_at_stake: u32,
    },
    /// Receipt for a [`Message::PairRequest`] — the responder has queued the
    /// request for human confirmation. Not an acceptance.
    PairPending,
    /// The responder's verdict, sent after the human compared fingerprints.
    PairResponse {
        accepted: bool,
        /// The SURVIVING group — the single group both devices end up in. Equal
        /// to the initiator's offer when the responder joined it, or the
        /// responder's own group when it counter-offered. The initiator adopts
        /// this value, after re-checking locally that it may leave its own.
        device_group_id: String,
        display_name: String,
        /// The responder's Ed25519 public key (base64), so the initiator can
        /// persist the key it actually paired with.
        public_key_b64: String,
    },
    /// Keep-alive ping.
    Ping,
    /// Keep-alive pong response.
    Pong,
}

/// An entry in the manifest exchange.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub resource_type: String,
    pub resource_id: String,
    pub display_name: String,
    pub access_level: String,
    pub tags: Vec<String>,
}

/// Envelope for agent-to-agent messages.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentEnvelope {
    pub id: String,
    pub source_persona_id: String,
    pub target_persona_id: String,
    pub payload: Vec<u8>,
    pub timestamp: String,
}

// -- Handshake authentication -------------------------------------------
//
// Three legs, because two are not enough for *mutual* freshness:
//
//   A -> B  Hello        sig_a1 = Sign_A( "hello"        | A | nonce_a )
//   B -> A  HelloAck     sig_b  = Sign_B( "helloack"     | B | nonce_b | nonce_a )
//   A -> B  HelloConfirm sig_a2 = Sign_A( "helloconfirm" | A | nonce_a | nonce_b )
//
// `sig_a1` alone proves key possession but not liveness — it contains nothing
// B chose, so a recorded Hello replays forever. `sig_a2` closes that: it covers
// B's nonce, which B generated for this session only. Symmetrically `sig_b`
// covers A's nonce. Each side therefore ends the handshake holding a signature
// over a value it personally contributed.
//
// The QUIC/TLS layer below is unchanged and provides confidentiality only. Its
// certificates are per-bind self-signed and unrelated to the Ed25519 identity —
// authentication is exactly this handshake, nothing else.

/// Build a signing transcript.
///
/// Encoding is `domain \n label \n peer_id \n nonce…`, newline-separated. This
/// is injective because every field is drawn from a newline-free alphabet:
/// `peer_id` is base58, nonces are base64, and both `domain` and `label` are
/// compile-time constants. Field counts differ per label, so no two labels can
/// produce colliding transcripts even before the label itself is compared.
fn transcript(label: &str, peer_id: &str, nonces: &[&str]) -> Vec<u8> {
    let mut s = String::with_capacity(128);
    s.push_str(HANDSHAKE_DOMAIN);
    s.push('\n');
    s.push_str(label);
    s.push('\n');
    s.push_str(peer_id);
    for n in nonces {
        s.push('\n');
        s.push_str(n);
    }
    s.into_bytes()
}

/// Transcript the initiator signs in `Hello`.
pub fn hello_transcript(peer_id: &str, client_nonce: &str) -> Vec<u8> {
    transcript("hello", peer_id, &[client_nonce])
}

/// Transcript the responder signs in `HelloAck` (covers the client nonce, so
/// the responder's proof is bound to this session).
pub fn hello_ack_transcript(peer_id: &str, server_nonce: &str, client_nonce: &str) -> Vec<u8> {
    transcript("helloack", peer_id, &[server_nonce, client_nonce])
}

/// Transcript the initiator signs in `HelloConfirm` (covers the server nonce).
pub fn hello_confirm_transcript(peer_id: &str, client_nonce: &str, server_nonce: &str) -> Vec<u8> {
    transcript("helloconfirm", peer_id, &[client_nonce, server_nonce])
}

/// Generate a fresh base64 handshake nonce.
pub fn generate_nonce() -> String {
    let mut bytes = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    B64.encode(bytes)
}

/// Reject a nonce that is not exactly [`NONCE_LEN`] bytes of base64. A peer
/// that supplies a short/empty nonce would otherwise weaken the freshness
/// guarantee for *both* sides.
pub fn validate_nonce(nonce: &str, whose: &str) -> Result<(), AppError> {
    let bytes = B64
        .decode(nonce)
        .map_err(|e| AppError::Validation(format!("{whose} nonce is not valid base64: {e}")))?;
    if bytes.len() != NONCE_LEN {
        return Err(AppError::Validation(format!(
            "{whose} nonce must be {NONCE_LEN} bytes, got {}",
            bytes.len()
        )));
    }
    Ok(())
}

/// Verify that a claimed `peer_id` really is the hash of the presented public
/// key, then that `signature` over `transcript` verifies under that key.
///
/// Both halves matter. The binding check stops a peer from claiming someone
/// else's peer_id while signing with its own key; the signature check stops it
/// from claiming an identity whose key it does not hold. Either failure is a
/// hard reject with the reason in the message (the caller logs it).
pub fn verify_handshake_proof(
    claimed_peer_id: &str,
    public_key_b64: &str,
    transcript: &[u8],
    signature_b64: &str,
) -> Result<(), AppError> {
    let derived = crate::identity::peer_id_from_public_key_b64(public_key_b64)?;
    if derived != claimed_peer_id {
        return Err(AppError::Validation(format!(
            "peer_id does not match the presented public key \
             (claimed {claimed_peer_id}, key hashes to {derived})"
        )));
    }
    let ok = crate::identity::verify_signature(public_key_b64, transcript, signature_b64)?;
    if !ok {
        return Err(AppError::Validation(format!(
            "handshake signature from {claimed_peer_id} did not verify against its public key"
        )));
    }
    Ok(())
}

// -- Pairing fingerprint -------------------------------------------------

/// Derive the short human-comparable pairing code.
///
/// ```text
/// (lo, hi) = sort([peer_id_a, peer_id_b])          // lexicographic
/// digest   = SHA256("personas-p2p-pairing/v1" \n lo \n hi \n session_nonce)
/// n        = u32::from_be_bytes(digest[0..4]) % 1_000_000
/// code     = format!("{n:06}") with a dash after 3 digits   → "042-917"
/// ```
///
/// Sorting the two peer_ids is what makes the derivation *order-independent*:
/// the initiator computes it as (self, remote) and the responder as (remote,
/// self), and both land on the same input. The session nonce (supplied by the
/// initiator in `PairRequest`) makes the code fresh per ceremony rather than a
/// fixed function of the two identities.
///
/// Six decimal digits (~20 bits) is a comparison code, not a secret — its job
/// is to let two humans notice that a machine-in-the-middle substituted a
/// different peer. The modulo bias over a 32-bit draw is ~10^-4 relative and
/// irrelevant for that purpose.
pub fn pairing_fingerprint(peer_id_a: &str, peer_id_b: &str, session_nonce: &str) -> String {
    let (lo, hi) = if peer_id_a <= peer_id_b {
        (peer_id_a, peer_id_b)
    } else {
        (peer_id_b, peer_id_a)
    };
    let mut hasher = Sha256::new();
    hasher.update(PAIRING_DOMAIN.as_bytes());
    hasher.update(b"\n");
    hasher.update(lo.as_bytes());
    hasher.update(b"\n");
    hasher.update(hi.as_bytes());
    hasher.update(b"\n");
    hasher.update(session_nonce.as_bytes());
    let digest = hasher.finalize();
    let n = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    let s = format!("{n:06}");
    format!("{}-{}", &s[..3], &s[3..])
}

/// Encode a message to bytes with a 4-byte big-endian length prefix.
pub fn encode(msg: &Message) -> Result<Vec<u8>, AppError> {
    let payload = rmp_serde::to_vec(msg)
        .map_err(|e| AppError::Internal(format!("MessagePack encode error: {e}")))?;
    let len = payload.len() as u32;
    if len > MAX_MESSAGE_SIZE {
        return Err(AppError::Validation(format!(
            "Message too large: {} bytes (max {})",
            len, MAX_MESSAGE_SIZE
        )));
    }
    let mut buf = Vec::with_capacity(4 + payload.len());
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(&payload);
    Ok(buf)
}

/// Decode a message from a reader (reads length prefix then payload).
pub async fn decode<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Message, AppError> {
    let mut len_buf = [0u8; 4];
    reader
        .read_exact(&mut len_buf)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read message length: {e}")))?;
    let len = u32::from_be_bytes(len_buf);

    if len > MAX_MESSAGE_SIZE {
        return Err(AppError::Validation(format!(
            "Message too large: {} bytes (max {})",
            len, MAX_MESSAGE_SIZE
        )));
    }

    let mut payload = vec![0u8; len as usize];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read message payload: {e}")))?;

    rmp_serde::from_slice(&payload)
        .map_err(|e| AppError::Internal(format!("MessagePack decode error: {e}")))
}

/// Write an encoded message to a writer.
pub async fn write_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    msg: &Message,
) -> Result<(), AppError> {
    let bytes = encode(msg)?;
    writer
        .write_all(&bytes)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write message: {e}")))?;
    writer
        .flush()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to flush message: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// A throwaway identity: (peer_id, public_key_b64, signing key).
    fn identity() -> (String, String, SigningKey) {
        let key = SigningKey::generate(&mut rand::rngs::OsRng);
        let vk = key.verifying_key();
        let peer_id = crate::identity::public_key_to_peer_id(&vk);
        (peer_id, B64.encode(vk.as_bytes()), key)
    }

    fn sign(key: &SigningKey, msg: &[u8]) -> String {
        B64.encode(key.sign(msg).to_bytes())
    }

    /// The pairing messages carry the two facts the counter-offer needs — the
    /// initiator's at-stake count out, the surviving group back — and survive
    /// the positional MessagePack encoding intact. v2 has never shipped, so
    /// adding the field was a clean wire change with no compatibility shim.
    #[test]
    fn pairing_messages_round_trip_the_counter_offer_fields() {
        assert_eq!(PROTOCOL_VERSION, 2, "the counter-offer ships as part of v2");

        let req = Message::PairRequest {
            session_nonce: generate_nonce(),
            device_group_id: "group-A".into(),
            display_name: "Laptop".into(),
            devices_at_stake: 3,
        };
        let bytes = rmp_serde::to_vec(&req).expect("encode");
        match rmp_serde::from_slice::<Message>(&bytes).expect("decode") {
            Message::PairRequest {
                device_group_id,
                devices_at_stake,
                ..
            } => {
                assert_eq!(device_group_id, "group-A");
                assert_eq!(devices_at_stake, 3);
            }
            other => panic!("expected PairRequest, got {other:?}"),
        }

        let resp = Message::PairResponse {
            accepted: true,
            device_group_id: "group-B".into(),
            display_name: "Desktop".into(),
            public_key_b64: "pk".into(),
        };
        let bytes = rmp_serde::to_vec(&resp).expect("encode");
        match rmp_serde::from_slice::<Message>(&bytes).expect("decode") {
            // The counter-offer case: the group coming back is the responder's,
            // not the one the initiator proposed.
            Message::PairResponse {
                device_group_id, ..
            } => assert_eq!(device_group_id, "group-B"),
            other => panic!("expected PairResponse, got {other:?}"),
        }
    }

    #[test]
    fn a_valid_proof_is_accepted() {
        let (peer_id, pk, key) = identity();
        let nonce = generate_nonce();
        let t = hello_transcript(&peer_id, &nonce);
        verify_handshake_proof(&peer_id, &pk, &t, &sign(&key, &t)).expect("valid proof");
    }

    #[test]
    fn a_signature_from_a_different_key_is_rejected() {
        let (peer_id, pk, _key) = identity();
        let (_, _, attacker) = identity();
        let nonce = generate_nonce();
        let t = hello_transcript(&peer_id, &nonce);
        let err = verify_handshake_proof(&peer_id, &pk, &t, &sign(&attacker, &t))
            .expect_err("a foreign signature must be refused");
        assert!(
            err.to_string().contains("did not verify"),
            "unexpected reason: {err}"
        );
    }

    #[test]
    fn a_peer_id_that_does_not_hash_from_the_public_key_is_rejected() {
        // The attacker holds a real key but claims someone else's peer_id.
        let (victim_peer_id, _victim_pk, _) = identity();
        let (_, attacker_pk, attacker_key) = identity();
        let nonce = generate_nonce();
        let t = hello_transcript(&victim_peer_id, &nonce);
        let err = verify_handshake_proof(&victim_peer_id, &attacker_pk, &t, &sign(&attacker_key, &t))
            .expect_err("peer_id/public-key mismatch must be refused");
        assert!(
            err.to_string().contains("does not match"),
            "unexpected reason: {err}"
        );
    }

    #[test]
    fn a_proof_for_a_different_nonce_does_not_verify() {
        let (peer_id, pk, key) = identity();
        let recorded = hello_transcript(&peer_id, &generate_nonce());
        let signature = sign(&key, &recorded);
        // Replay the old signature against a fresh session's transcript.
        let fresh = hello_transcript(&peer_id, &generate_nonce());
        assert!(verify_handshake_proof(&peer_id, &pk, &fresh, &signature).is_err());
    }

    #[test]
    fn transcript_labels_are_domain_separated() {
        let (peer_id, _, _) = identity();
        let a = generate_nonce();
        let b = generate_nonce();
        assert_ne!(
            hello_ack_transcript(&peer_id, &a, &b),
            hello_confirm_transcript(&peer_id, &a, &b),
            "an ack proof must not be reusable as a confirm proof"
        );
        // Nonce order is load-bearing too.
        assert_ne!(
            hello_ack_transcript(&peer_id, &a, &b),
            hello_ack_transcript(&peer_id, &b, &a)
        );
    }

    #[test]
    fn nonce_validation_rejects_short_and_malformed() {
        validate_nonce(&generate_nonce(), "test").expect("a generated nonce is valid");
        assert!(validate_nonce("", "test").is_err());
        assert!(validate_nonce(&B64.encode([0u8; 8]), "test").is_err());
        assert!(validate_nonce("not base64!!", "test").is_err());
    }

    /// The whole point of the fingerprint: the two devices compute it from
    /// mirrored inputs and must land on the same six digits.
    #[test]
    fn both_devices_derive_the_same_fingerprint() {
        let (a, _, _) = identity();
        let (b, _, _) = identity();
        let session = generate_nonce();

        // Initiator computes (self, remote); responder computes (remote, self).
        let initiator = pairing_fingerprint(&a, &b, &session);
        let responder = pairing_fingerprint(&b, &a, &session);
        assert_eq!(initiator, responder, "fingerprint must be order-independent");
        assert_eq!(initiator.len(), 7, "format is NNN-NNN");
        assert_eq!(&initiator[3..4], "-");
        assert!(initiator
            .chars()
            .filter(|c| *c != '-')
            .all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn fingerprint_changes_with_the_session_nonce_and_with_the_peers() {
        let (a, _, _) = identity();
        let (b, _, _) = identity();
        let (c, _, _) = identity();
        let s1 = generate_nonce();
        let s2 = generate_nonce();
        assert_ne!(
            pairing_fingerprint(&a, &b, &s1),
            pairing_fingerprint(&a, &b, &s2),
            "a new ceremony must produce a new code"
        );
        assert_ne!(
            pairing_fingerprint(&a, &b, &s1),
            pairing_fingerprint(&a, &c, &s1),
            "a substituted peer must produce a different code"
        );
    }

    #[test]
    fn fingerprint_is_deterministic_across_calls() {
        let (a, _, _) = identity();
        let (b, _, _) = identity();
        let s = generate_nonce();
        assert_eq!(
            pairing_fingerprint(&a, &b, &s),
            pairing_fingerprint(&a, &b, &s)
        );
    }
}

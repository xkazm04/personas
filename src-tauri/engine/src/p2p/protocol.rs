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
///
/// **v3 (channel-bound handshake).** v2's proofs were genuine but *portable*:
/// no field in any of the three transcripts came from the TLS session carrying
/// them. Combined with the deliberately-unverified QUIC certificates in
/// [`super::transport`] and no application-layer encryption, an on-path
/// attacker could terminate TLS to each side and relay all three signed
/// messages verbatim. Both peers then verified each other's real signatures
/// and -- worse -- derived the *same* [`pairing_fingerprint`], so the human
/// comparison the pairing ceremony rests on succeeded under an active MITM.
/// v3 mixes [`super::transport::channel_binding`] into every transcript and
/// into the fingerprint, so a relayed proof no longer verifies.
///
/// The version check is a hard reject on both sides, so a v2 peer meeting a v3
/// peer gets a named "incompatible protocol version" error rather than a
/// baffling signature failure. There is deliberately NO negotiation: an
/// attacker would simply advertise v2, which is exactly the downgrade this
/// revision exists to prevent.
pub const PROTOCOL_VERSION: u32 = 3;

/// Maximum message size (16 MB) to prevent memory exhaustion from malicious peers.
const MAX_MESSAGE_SIZE: u32 = 16 * 1024 * 1024;

/// Handshake nonce length in bytes (before base64).
pub const NONCE_LEN: usize = 32;

/// Domain separator for every signature in this protocol. Prevents a signature
/// produced for one purpose (identity card, enclave seal, a future protocol
/// revision) from being replayed as a handshake proof.
pub const HANDSHAKE_DOMAIN: &str = "personas-p2p-handshake/v3";

/// Domain separator for the pairing fingerprint derivation.
pub const PAIRING_DOMAIN: &str = "personas-p2p-pairing/v2";

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
    /// Ask a PAIRED device to run a natural-language instruction.
    ///
    /// Only a peer with a row in `owned_devices` may send this — see
    /// [`super::remote_jobs::RemoteJobs::handle_message`], which is the single
    /// place that trust is enforced on the job path. Completing the signed
    /// handshake is emphatically NOT enough: any LAN peer can do that.
    RemoteJobRequest {
        /// Minted by the originating device; both sides key the exchange by it.
        job_id: String,
        /// Job discriminator. Only `"instruction"` exists today; the field ships
        /// now, while v2 is unshipped, so a later typed-job lane (run this
        /// recipe, sync this persona) needs no protocol break.
        kind: String,
        /// What the originating device's Athena was asked to have run.
        instruction: String,
        /// The originating device's display name, so the running device can say
        /// whose request it is without a registry lookup.
        origin_display_name: String,
    },
    /// Receipt for a [`Message::RemoteJobRequest`] — accepted, or refused with
    /// the reason. Written back on the same stream, like `Ping`→`Pong`.
    RemoteJobAck {
        job_id: String,
        accepted: bool,
        /// Populated only when `accepted` is false.
        reason: Option<String>,
    },
    /// A progress note from the device running the job.
    ///
    /// `seq` is 1-based, monotonic and gapless per job, minted by an atomic bump
    /// on the running side. It is what makes redelivery after a reconnect
    /// exactly-once: the originating device keys notes on `(job_id, seq)`.
    RemoteJobProgress {
        job_id: String,
        seq: u32,
        text: String,
    },
    /// The terminal outcome of a remote job.
    RemoteJobResult {
        job_id: String,
        /// A `RemoteJobStatus` token: `completed` / `failed` / `cancelled`.
        status: String,
        summary: String,
    },
    /// Sent by the ORIGINATING device on reconnect: "for this job I hold every
    /// note up to `last_seq`; send me the rest."
    ///
    /// The running device answers on the same stream with the missing
    /// [`Message::RemoteJobProgress`] frames in order, followed by
    /// [`Message::RemoteJobResult`] if the job has since finished. A job that
    /// was running when the link dropped keeps running; only the delivery
    /// resumes.
    RemoteJobResume { job_id: String, last_seq: u32 },
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
//   A -> B  Hello        sig_a1 = Sign_A( "hello"        | A | cb | nonce_a )
//   B -> A  HelloAck     sig_b  = Sign_B( "helloack"     | B | cb | nonce_b | nonce_a )
//   A -> B  HelloConfirm sig_a2 = Sign_A( "helloconfirm" | A | cb | nonce_a | nonce_b )
//
// `sig_a1` alone proves key possession but not liveness — it contains nothing
// B chose, so a recorded Hello replays forever. `sig_a2` closes that: it covers
// B's nonce, which B generated for this session only. Symmetrically `sig_b`
// covers A's nonce. Each side therefore ends the handshake holding a signature
// over a value it personally contributed.
//
// `cb` is the CHANNEL BINDING: [`super::transport::channel_binding`], an RFC
// 5705 exporter over the QUIC/TLS session actually carrying these bytes. It is
// what ties the two layers together, and v2 did not have it. The QUIC layer
// gives confidentiality against a PASSIVE observer, but its certificates are
// per-bind, self-signed and unrelated to the Ed25519 identity — nothing checks
// them. So without `cb` the three proofs above are perfectly valid and
// perfectly PORTABLE: an on-path attacker terminates TLS to each side and
// forwards every signed message byte for byte, and both ends conclude they are
// talking to each other. With `cb` the two TLS sessions export different
// values, A signs over one and B verifies over the other, and the relay is
// refused at the first signature check.

/// Build a signing transcript.
///
/// Encoding is `domain \n label \n peer_id \n channel_binding \n nonce…`,
/// newline-separated. This is injective because every field is drawn from a
/// newline-free alphabet: `peer_id` is base58, the channel binding and the
/// nonces are base64, and both `domain` and `label` are compile-time constants.
/// Field counts differ per label, so no two labels can produce colliding
/// transcripts even before the label itself is compared.
fn transcript(label: &str, peer_id: &str, channel_binding: &str, nonces: &[&str]) -> Vec<u8> {
    let mut s = String::with_capacity(160);
    s.push_str(HANDSHAKE_DOMAIN);
    s.push('\n');
    s.push_str(label);
    s.push('\n');
    s.push_str(peer_id);
    s.push('\n');
    s.push_str(channel_binding);
    for n in nonces {
        s.push('\n');
        s.push_str(n);
    }
    s.into_bytes()
}

/// Transcript the initiator signs in `Hello`.
///
/// `channel_binding` comes from [`super::transport::channel_binding`] on the
/// QUIC connection this message is written to — never from the wire. Taking it
/// from a peer-supplied field would defeat the entire mechanism.
pub fn hello_transcript(peer_id: &str, channel_binding: &str, client_nonce: &str) -> Vec<u8> {
    transcript("hello", peer_id, channel_binding, &[client_nonce])
}

/// Transcript the responder signs in `HelloAck` (covers the client nonce, so
/// the responder's proof is bound to this session).
pub fn hello_ack_transcript(
    peer_id: &str,
    channel_binding: &str,
    server_nonce: &str,
    client_nonce: &str,
) -> Vec<u8> {
    transcript(
        "helloack",
        peer_id,
        channel_binding,
        &[server_nonce, client_nonce],
    )
}

/// Transcript the initiator signs in `HelloConfirm` (covers the server nonce).
pub fn hello_confirm_transcript(
    peer_id: &str,
    channel_binding: &str,
    client_nonce: &str,
    server_nonce: &str,
) -> Vec<u8> {
    transcript(
        "helloconfirm",
        peer_id,
        channel_binding,
        &[client_nonce, server_nonce],
    )
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
/// digest   = SHA256("personas-p2p-pairing/v2" \n lo \n hi \n session_nonce \n cb)
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
/// `channel_binding` is [`super::transport::channel_binding`] for the QUIC
/// connection the ceremony runs over, and it is what makes the human check
/// INDEPENDENTLY able to catch a machine-in-the-middle. In v1 this derivation
/// was a pure function of two *public* peer_ids and a nonce that travelled on
/// the wire, so a relaying attacker holding two TLS sessions computed nothing
/// at all — both screens simply showed the same code and the human confirmed a
/// MITM. Now the two sessions export different values, so the codes differ and
/// the comparison fails, even if the handshake binding above were ever weakened.
///
/// Six decimal digits (~20 bits) is a comparison code, not a secret — its job
/// is to let two humans notice that a machine-in-the-middle substituted a
/// different peer. The modulo bias over a 32-bit draw is ~10^-4 relative and
/// irrelevant for that purpose.
pub fn pairing_fingerprint(
    peer_id_a: &str,
    peer_id_b: &str,
    session_nonce: &str,
    channel_binding: &str,
) -> String {
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
    hasher.update(b"\n");
    hasher.update(channel_binding.as_bytes());
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

    /// A stand-in for [`super::super::transport::channel_binding`]: any two
    /// distinct TLS sessions export distinct values, which is the only property
    /// these tests depend on. Real exporter agreement between the two ends of
    /// ONE session is covered by `transport::tests`, which drives real quinn.
    fn channel() -> String {
        generate_nonce()
    }

    /// The pairing messages carry the two facts the counter-offer needs — the
    /// initiator's at-stake count out, the surviving group back — and survive
    /// the positional MessagePack encoding intact. v2 has never shipped, so
    /// adding the field was a clean wire change with no compatibility shim.
    #[test]
    fn pairing_messages_round_trip_the_counter_offer_fields() {
        assert_eq!(
            PROTOCOL_VERSION, 3,
            "the counter-offer shipped in v2 and rides along unchanged in v3"
        );

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

    /// Every remote-job frame must survive the positional MessagePack encoding
    /// with its fields intact and in the right slots. Positional encoding means
    /// a field reordered in the enum silently reinterprets the payload, so this
    /// asserts VALUES, not just that decoding succeeded.
    #[test]
    fn remote_job_messages_round_trip_every_field() {
        fn round_trip(msg: &Message) -> Message {
            let bytes = rmp_serde::to_vec(msg).expect("encode");
            rmp_serde::from_slice::<Message>(&bytes).expect("decode")
        }

        match round_trip(&Message::RemoteJobRequest {
            job_id: "job-1".into(),
            kind: "instruction".into(),
            instruction: "summarize today's inbox".into(),
            origin_display_name: "Laptop".into(),
        }) {
            Message::RemoteJobRequest {
                job_id,
                kind,
                instruction,
                origin_display_name,
            } => {
                assert_eq!(job_id, "job-1");
                assert_eq!(kind, "instruction");
                assert_eq!(instruction, "summarize today's inbox");
                assert_eq!(origin_display_name, "Laptop");
            }
            other => panic!("expected RemoteJobRequest, got {other:?}"),
        }

        // Both ack shapes: the acceptance carries no reason, the refusal does.
        match round_trip(&Message::RemoteJobAck {
            job_id: "job-1".into(),
            accepted: true,
            reason: None,
        }) {
            Message::RemoteJobAck {
                accepted, reason, ..
            } => {
                assert!(accepted);
                assert!(reason.is_none());
            }
            other => panic!("expected RemoteJobAck, got {other:?}"),
        }
        match round_trip(&Message::RemoteJobAck {
            job_id: "job-1".into(),
            accepted: false,
            reason: Some("not a paired device".into()),
        }) {
            Message::RemoteJobAck {
                accepted, reason, ..
            } => {
                assert!(!accepted);
                assert_eq!(reason.as_deref(), Some("not a paired device"));
            }
            other => panic!("expected RemoteJobAck, got {other:?}"),
        }

        match round_trip(&Message::RemoteJobProgress {
            job_id: "job-1".into(),
            seq: 7,
            text: "read 42 messages".into(),
        }) {
            Message::RemoteJobProgress { job_id, seq, text } => {
                assert_eq!(job_id, "job-1");
                assert_eq!(seq, 7);
                assert_eq!(text, "read 42 messages");
            }
            other => panic!("expected RemoteJobProgress, got {other:?}"),
        }

        match round_trip(&Message::RemoteJobResult {
            job_id: "job-1".into(),
            status: "completed".into(),
            summary: "three things need you".into(),
        }) {
            Message::RemoteJobResult {
                job_id,
                status,
                summary,
            } => {
                assert_eq!(job_id, "job-1");
                assert_eq!(status, "completed");
                assert_eq!(summary, "three things need you");
            }
            other => panic!("expected RemoteJobResult, got {other:?}"),
        }

        match round_trip(&Message::RemoteJobResume {
            job_id: "job-1".into(),
            last_seq: 3,
        }) {
            Message::RemoteJobResume { job_id, last_seq } => {
                assert_eq!(job_id, "job-1");
                assert_eq!(last_seq, 3);
            }
            other => panic!("expected RemoteJobResume, got {other:?}"),
        }
    }

    /// The remote-job frames shipped as part of the never-released v2 and are
    /// unchanged by the v3 channel-binding revision. Pin the version so a
    /// future shape change against a SHIPPED protocol has to be a deliberate
    /// decision rather than an accident.
    #[test]
    fn remote_job_frames_are_part_of_the_current_protocol() {
        assert_eq!(PROTOCOL_VERSION, 3);
    }

    #[test]
    fn a_valid_proof_is_accepted() {
        let (peer_id, pk, key) = identity();
        let nonce = generate_nonce();
        let t = hello_transcript(&peer_id, &channel(), &nonce);
        verify_handshake_proof(&peer_id, &pk, &t, &sign(&key, &t)).expect("valid proof");
    }

    #[test]
    fn a_signature_from_a_different_key_is_rejected() {
        let (peer_id, pk, _key) = identity();
        let (_, _, attacker) = identity();
        let nonce = generate_nonce();
        let t = hello_transcript(&peer_id, &channel(), &nonce);
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
        let t = hello_transcript(&victim_peer_id, &channel(), &nonce);
        let err =
            verify_handshake_proof(&victim_peer_id, &attacker_pk, &t, &sign(&attacker_key, &t))
                .expect_err("peer_id/public-key mismatch must be refused");
        assert!(
            err.to_string().contains("does not match"),
            "unexpected reason: {err}"
        );
    }

    #[test]
    fn a_proof_for_a_different_nonce_does_not_verify() {
        let (peer_id, pk, key) = identity();
        let cb = channel();
        let recorded = hello_transcript(&peer_id, &cb, &generate_nonce());
        let signature = sign(&key, &recorded);
        // Replay the old signature against a fresh session's transcript.
        let fresh = hello_transcript(&peer_id, &cb, &generate_nonce());
        assert!(verify_handshake_proof(&peer_id, &pk, &fresh, &signature).is_err());
    }

    #[test]
    fn transcript_labels_are_domain_separated() {
        let (peer_id, _, _) = identity();
        let cb = channel();
        let a = generate_nonce();
        let b = generate_nonce();
        assert_ne!(
            hello_ack_transcript(&peer_id, &cb, &a, &b),
            hello_confirm_transcript(&peer_id, &cb, &a, &b),
            "an ack proof must not be reusable as a confirm proof"
        );
        // Nonce order is load-bearing too.
        assert_ne!(
            hello_ack_transcript(&peer_id, &cb, &a, &b),
            hello_ack_transcript(&peer_id, &cb, &b, &a)
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
        // One shared TLS session => one shared binding on both ends.
        let cb = channel();

        // Initiator computes (self, remote); responder computes (remote, self).
        let initiator = pairing_fingerprint(&a, &b, &session, &cb);
        let responder = pairing_fingerprint(&b, &a, &session, &cb);
        assert_eq!(
            initiator, responder,
            "fingerprint must be order-independent"
        );
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
        let cb = channel();
        assert_ne!(
            pairing_fingerprint(&a, &b, &s1, &cb),
            pairing_fingerprint(&a, &b, &s2, &cb),
            "a new ceremony must produce a new code"
        );
        assert_ne!(
            pairing_fingerprint(&a, &b, &s1, &cb),
            pairing_fingerprint(&a, &c, &s1, &cb),
            "a substituted peer must produce a different code"
        );
    }

    #[test]
    fn fingerprint_is_deterministic_across_calls() {
        let (a, _, _) = identity();
        let (b, _, _) = identity();
        let s = generate_nonce();
        let cb = channel();
        assert_eq!(
            pairing_fingerprint(&a, &b, &s, &cb),
            pairing_fingerprint(&a, &b, &s, &cb)
        );
    }

    // -- Channel binding: the v3 property -------------------------------

    /// **The regression test for the v2 MITM.**
    ///
    /// Replays the full three-leg handshake through a relay. `M` terminates TLS
    /// to each side, so it holds two distinct sessions (`cb_am`, `cb_mb`) and
    /// two distinct exporter values. It forwards every signed message BYTE FOR
    /// BYTE — it forges nothing, it does not need either private key, and every
    /// signature it relays is genuine. In v2 that was enough: nothing in any
    /// transcript came from the channel, so all three proofs verified at the
    /// far end and both peers concluded they were talking to each other.
    ///
    /// Under v3 each side builds its verification transcript from the binding
    /// of ITS OWN session, so all three legs must be refused.
    #[test]
    fn a_relayed_handshake_is_refused_at_every_leg() {
        let (a_id, a_pk, a_key) = identity();
        let (b_id, b_pk, b_key) = identity();

        // Two TLS sessions, because the attacker terminated in the middle.
        let cb_am = channel();
        let cb_mb = channel();
        assert_ne!(cb_am, cb_mb, "a relay cannot hold one session end to end");

        let nonce_a = generate_nonce();
        let nonce_b = generate_nonce();

        // Leg 1 — A signs on A<->M, M relays it verbatim onto M<->B.
        let hello_sig = sign(&a_key, &hello_transcript(&a_id, &cb_am, &nonce_a));
        let err = verify_handshake_proof(
            &a_id,
            &a_pk,
            &hello_transcript(&a_id, &cb_mb, &nonce_a), // B's own channel
            &hello_sig,
        )
        .expect_err("a relayed Hello must not verify at the responder");
        assert!(
            err.to_string().contains("did not verify"),
            "unexpected reason: {err}"
        );

        // Leg 2 — B signs on M<->B, M relays it verbatim onto A<->M.
        let ack_sig = sign(
            &b_key,
            &hello_ack_transcript(&b_id, &cb_mb, &nonce_b, &nonce_a),
        );
        assert!(
            verify_handshake_proof(
                &b_id,
                &b_pk,
                &hello_ack_transcript(&b_id, &cb_am, &nonce_b, &nonce_a),
                &ack_sig,
            )
            .is_err(),
            "a relayed HelloAck must not verify at the initiator"
        );

        // Leg 3 — the confirm, same shape.
        let confirm_sig = sign(
            &a_key,
            &hello_confirm_transcript(&a_id, &cb_am, &nonce_a, &nonce_b),
        );
        assert!(
            verify_handshake_proof(
                &a_id,
                &a_pk,
                &hello_confirm_transcript(&a_id, &cb_mb, &nonce_a, &nonce_b),
                &confirm_sig,
            )
            .is_err(),
            "a relayed HelloConfirm must not verify at the responder"
        );

        // Control: on ONE honest end-to-end session all three legs verify, so
        // the rejections above are the binding at work and not a broken fixture.
        let cb = channel();
        for (id, pk, sig_key, t) in [
            (&a_id, &a_pk, &a_key, hello_transcript(&a_id, &cb, &nonce_a)),
            (
                &b_id,
                &b_pk,
                &b_key,
                hello_ack_transcript(&b_id, &cb, &nonce_b, &nonce_a),
            ),
            (
                &a_id,
                &a_pk,
                &a_key,
                hello_confirm_transcript(&a_id, &cb, &nonce_a, &nonce_b),
            ),
        ] {
            verify_handshake_proof(id, pk, &t, &sign(sig_key, &t))
                .expect("an honest single-channel handshake must still succeed");
        }
    }

    /// The property the transcripts gained, stated directly: identical identity
    /// and identical nonces over two different channels must not produce the
    /// same bytes to sign. Without it, a signature is portable between sessions.
    #[test]
    fn transcripts_differ_across_channels() {
        let (peer_id, _, _) = identity();
        let na = generate_nonce();
        let nb = generate_nonce();
        let cb1 = channel();
        let cb2 = channel();

        assert_ne!(
            hello_transcript(&peer_id, &cb1, &na),
            hello_transcript(&peer_id, &cb2, &na)
        );
        assert_ne!(
            hello_ack_transcript(&peer_id, &cb1, &nb, &na),
            hello_ack_transcript(&peer_id, &cb2, &nb, &na)
        );
        assert_ne!(
            hello_confirm_transcript(&peer_id, &cb1, &na, &nb),
            hello_confirm_transcript(&peer_id, &cb2, &na, &nb)
        );
    }

    /// Defense in depth for the human half of pairing. Even if the handshake
    /// binding above were ever weakened, a relay holding two sessions makes the
    /// two screens show DIFFERENT six-digit codes — which is exactly what the
    /// ceremony asks the operator to check, and what v1 of this derivation
    /// could never deliver.
    #[test]
    fn a_relay_cannot_make_both_screens_show_the_same_code() {
        let (a, _, _) = identity();
        let (b, _, _) = identity();
        // The relay chooses the session nonce it forwards, so give it the most
        // favourable case: the SAME nonce reaches both ends.
        let session = generate_nonce();

        let shown_to_a = pairing_fingerprint(&a, &b, &session, &channel());
        let shown_to_b = pairing_fingerprint(&b, &a, &session, &channel());
        assert_ne!(
            shown_to_a, shown_to_b,
            "two TLS sessions must not derive one comparison code"
        );
    }
}

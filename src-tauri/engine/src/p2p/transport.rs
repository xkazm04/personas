//! QUIC transport layer using quinn + rustls.
//!
//! Generates self-signed X.509 certificates from the node's identity and
//! configures a QUIC endpoint that accepts all peer certificates (peer_id
//! is verified post-handshake via the Hello/HelloAck exchange).
//!
//! The certificates are deliberately unauthenticated — they are freshly
//! generated per bind and unrelated to the node's Ed25519 identity, so there is
//! nothing to check them against. Identity comes from the signed handshake in
//! [`super::protocol`], and the link between that handshake and *this* TLS
//! session comes from [`channel_binding`]. Without that link the two layers are
//! independent and an on-path attacker can terminate TLS to each side and relay
//! the signed messages verbatim — see the module docs on [`channel_binding`].

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;

use personas_core::error::AppError;

/// Bytes of keying material exported for the handshake channel binding.
pub const CHANNEL_BINDING_LEN: usize = 32;

/// RFC 5705 exporter label. The `EXPORTER-` prefix is the convention for
/// application-defined labels; the suffix carries our protocol revision so a
/// future revision's binding cannot be mistaken for this one's.
const CHANNEL_BINDING_LABEL: &[u8] = b"EXPORTER-personas-p2p-channel-binding/v3";

/// Derive this QUIC connection's channel-binding value.
///
/// TLS 1.3 exporters (RFC 5705, and RFC 9266's `tls-exporter` binding type)
/// derive from the session's master secret, so the value is unique to *this*
/// TLS session and identical at both of its ends. Mixing it into every signed
/// handshake transcript is what makes the Ed25519 proofs non-relayable:
///
/// ```text
///   A ──TLS session 1── M ──TLS session 2── B
///        cb1                    cb2                cb1 != cb2
/// ```
///
/// A machine-in-the-middle can still forward each signed message byte for byte,
/// but A signs over `cb1` and B verifies over `cb2`, so the signature does not
/// verify and the handshake is refused before any application data flows. This
/// is the property the `SkipServerVerification` verifier below cannot provide
/// on its own, and it is why skipping certificate verification is tolerable
/// here: the certificate is not the thing being trusted, the exporter is.
pub fn channel_binding(conn: &quinn::Connection) -> Result<String, AppError> {
    let mut out = [0u8; CHANNEL_BINDING_LEN];
    conn.export_keying_material(&mut out, CHANNEL_BINDING_LABEL, b"")
        .map_err(|_| {
            AppError::Internal(
                "TLS keying-material export failed; cannot channel-bind the handshake".into(),
            )
        })?;
    Ok(B64.encode(out))
}

/// Wrapper around a quinn QUIC endpoint.
pub struct QuicTransport {
    peer_id: String,
    endpoint: RwLock<Option<quinn::Endpoint>>,
    local_addr: RwLock<Option<SocketAddr>>,
}

impl QuicTransport {
    pub fn new(peer_id: String) -> Result<Self, AppError> {
        Ok(Self {
            peer_id,
            endpoint: RwLock::new(None),
            local_addr: RwLock::new(None),
        })
    }

    /// Bind the QUIC endpoint to the given port and start listening.
    ///
    /// Builds a dual-stack IPv6 UDP socket (V6Only=false) so both IPv4 and
    /// IPv6 LAN peers can connect. Binding `0.0.0.0:port` directly would
    /// reject all IPv6 peers, and binding `[::]:port` without the V6Only
    /// override is IPv6-only on Windows. socket2 normalizes the platform
    /// difference.
    pub async fn bind(&self, port: u16) -> Result<(), AppError> {
        use socket2::{Domain, Protocol, Socket, Type};

        let (server_config, client_config) = build_tls_configs(&self.peer_id)?;

        let addr: SocketAddr = format!("[::]:{}", port)
            .parse()
            .map_err(|e| AppError::Internal(format!("Invalid bind address: {e}")))?;

        let socket = Socket::new(Domain::IPV6, Type::DGRAM, Some(Protocol::UDP))
            .map_err(|e| AppError::Internal(format!("UDP socket creation failed: {e}")))?;
        socket
            .set_only_v6(false)
            .map_err(|e| AppError::Internal(format!("Failed to enable dual-stack socket: {e}")))?;
        socket
            .set_nonblocking(true)
            .map_err(|e| AppError::Internal(format!("Failed to set non-blocking: {e}")))?;
        socket
            .bind(&addr.into())
            .map_err(|e| AppError::Internal(format!("UDP bind failed: {e}")))?;
        let std_socket: std::net::UdpSocket = socket.into();

        let mut endpoint = quinn::Endpoint::new(
            quinn::EndpointConfig::default(),
            Some(server_config),
            std_socket,
            Arc::new(quinn::TokioRuntime),
        )
        .map_err(|e| AppError::Internal(format!("Failed to create QUIC endpoint: {e}")))?;

        endpoint.set_default_client_config(client_config);

        let local = endpoint
            .local_addr()
            .map_err(|e| AppError::Internal(format!("Failed to get local addr: {e}")))?;

        tracing::info!(addr = %local, "QUIC endpoint bound (dual-stack)");

        *self.endpoint.write().await = Some(endpoint);
        *self.local_addr.write().await = Some(local);
        Ok(())
    }

    /// Accept an incoming QUIC connection.
    pub async fn accept(&self) -> Result<quinn::Connection, AppError> {
        let endpoint = self.endpoint.read().await;
        let endpoint = endpoint
            .as_ref()
            .ok_or_else(|| AppError::Internal("QUIC endpoint not bound".into()))?;

        let incoming = endpoint
            .accept()
            .await
            .ok_or_else(|| AppError::Internal("QUIC endpoint closed".into()))?;

        incoming
            .await
            .map_err(|e| AppError::Internal(format!("Failed to accept QUIC connection: {e}")))
    }

    /// Connect to a remote peer.
    pub async fn connect(&self, addr: SocketAddr) -> Result<quinn::Connection, AppError> {
        let endpoint = self.endpoint.read().await;
        let endpoint = endpoint
            .as_ref()
            .ok_or_else(|| AppError::Internal("QUIC endpoint not bound".into()))?;

        // Use "personas" as the server name (SNI) -- our verifier ignores it
        let conn = endpoint
            .connect(addr, "personas")
            .map_err(|e| AppError::Internal(format!("QUIC connect error: {e}")))?
            .await
            .map_err(|e| AppError::Internal(format!("QUIC connection failed: {e}")))?;

        Ok(conn)
    }

    /// Get the local port the endpoint is listening on.
    pub async fn local_port(&self) -> Option<u16> {
        self.local_addr.read().await.map(|a| a.port())
    }
}

/// Build rustls ServerConfig and quinn ClientConfig with a self-signed cert.
fn build_tls_configs(
    peer_id: &str,
) -> Result<(quinn::ServerConfig, quinn::ClientConfig), AppError> {
    // Generate a self-signed certificate
    let subject_alt_names = vec![peer_id.to_string()];
    let key_pair = rcgen::KeyPair::generate()
        .map_err(|e| AppError::Internal(format!("Key pair generation error: {e}")))?;
    let cert_params = rcgen::CertificateParams::new(subject_alt_names)
        .map_err(|e| AppError::Internal(format!("Cert params error: {e}")))?;
    let cert = cert_params
        .self_signed(&key_pair)
        .map_err(|e| AppError::Internal(format!("Self-signed cert error: {e}")))?;

    let cert_der = cert.der().clone();
    let key_der = key_pair.serialize_der();

    let cert_chain = vec![cert_der];
    let private_key = rustls::pki_types::PrivatePkcs8KeyDer::from(key_der);

    // Server config: present our cert, accept all client certs
    let server_crypto = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            cert_chain.clone(),
            rustls::pki_types::PrivateKeyDer::Pkcs8(private_key.clone_key()),
        )
        .map_err(|e| AppError::Internal(format!("Server TLS config error: {e}")))?;

    let server_config = quinn::ServerConfig::with_crypto(Arc::new(
        quinn::crypto::rustls::QuicServerConfig::try_from(server_crypto)
            .map_err(|e| AppError::Internal(format!("QUIC server config error: {e}")))?,
    ));

    // Client config: skip server cert verification (we verify peer_id in protocol)
    let client_crypto = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(SkipServerVerification))
        .with_client_auth_cert(
            cert_chain,
            rustls::pki_types::PrivateKeyDer::Pkcs8(private_key.clone_key()),
        )
        .map_err(|e| AppError::Internal(format!("Client TLS config error: {e}")))?;

    let client_config = quinn::ClientConfig::new(Arc::new(
        quinn::crypto::rustls::QuicClientConfig::try_from(client_crypto)
            .map_err(|e| AppError::Internal(format!("QUIC client config error: {e}")))?,
    ));

    Ok((server_config, client_config))
}

/// Custom certificate verifier that accepts all server certificates.
///
/// Peer identity is established by the signed handshake in [`super::protocol`],
/// and that handshake is bound to this TLS session by [`channel_binding`], so
/// accepting an unknown certificate does not admit a machine-in-the-middle: an
/// attacker who terminates TLS gets a *different* exporter value than the one
/// the far end signs over. Do not remove that binding without replacing this
/// verifier with a real one.
#[derive(Debug)]
struct SkipServerVerification;

impl rustls::client::danger::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ECDSA_NISTP521_SHA512,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::ED448,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The app installs the rustls provider in `main.rs` before anything opens
    /// a connection; a test binary has no `main.rs`, so do it here. Idempotent
    /// and shared, because `install_default` is process-global and errors on a
    /// second call.
    fn install_crypto_provider() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    /// Bind a loopback endpoint with the app's real TLS configuration.
    fn endpoint(peer_id: &str) -> quinn::Endpoint {
        install_crypto_provider();
        let (server_config, client_config) = build_tls_configs(peer_id).expect("tls configs");
        let mut ep =
            quinn::Endpoint::server(server_config, "127.0.0.1:0".parse().expect("loopback addr"))
                .expect("bind endpoint");
        ep.set_default_client_config(client_config);
        ep
    }

    /// Dial `server` from `client` and return the binding each END of that one
    /// QUIC session exports.
    async fn dial(client: &quinn::Endpoint, server: &quinn::Endpoint) -> (String, String) {
        let addr = server.local_addr().expect("server addr");
        let accept = tokio::spawn({
            let server = server.clone();
            async move {
                server
                    .accept()
                    .await
                    .expect("incoming")
                    .await
                    .expect("accepted connection")
            }
        });
        let outgoing = client
            .connect(addr, "personas")
            .expect("connect")
            .await
            .expect("handshake");
        let incoming = accept.await.expect("accept task");
        (
            channel_binding(&outgoing).expect("client-side export"),
            channel_binding(&incoming).expect("server-side export"),
        )
    }

    /// The two properties the handshake binding rests on, over REAL quinn:
    ///
    /// 1. both ends of one session export the SAME value — otherwise an honest
    ///    handshake could never verify;
    /// 2. two separate sessions export DIFFERENT values — which is what a
    ///    machine-in-the-middle is forced into, since it must terminate TLS
    ///    to each side and therefore holds two sessions, not one.
    ///
    /// Together these say: a signature over the binding is valid exactly on the
    /// session that produced it, and nowhere else.
    #[tokio::test]
    async fn channel_binding_agrees_within_a_session_and_differs_between_them() {
        let a = endpoint("peer-a");
        let b = endpoint("peer-b");

        let (a1_client, a1_server) = dial(&a, &b).await;
        assert_eq!(
            a1_client, a1_server,
            "both ends of one QUIC session must export the same binding"
        );

        // A second, independent session — the shape a relay is stuck with.
        let (a2_client, a2_server) = dial(&a, &b).await;
        assert_eq!(a2_client, a2_server);
        assert_ne!(
            a1_client, a2_client,
            "a distinct TLS session must export a distinct binding; \
             if these ever collide the relay defence is void"
        );

        // Non-degenerate: 32 bytes of exported material, base64-encoded.
        assert_eq!(
            B64.decode(&a1_client).expect("base64").len(),
            CHANNEL_BINDING_LEN
        );
        assert_ne!(a1_client, B64.encode([0u8; CHANNEL_BINDING_LEN]));
    }
}

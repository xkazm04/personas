//! QUIC transport layer using quinn + rustls.
//!
//! Generates self-signed X.509 certificates from the node's identity and
//! configures a QUIC endpoint that accepts all peer certificates (peer_id
//! is verified post-handshake via the Hello/HelloAck exchange).

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::AppError;

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
    pub async fn bind(&self, port: u16) -> Result<(), AppError> {
        let (server_config, client_config) = build_tls_configs(&self.peer_id)?;

        let addr: SocketAddr = format!("0.0.0.0:{}", port)
            .parse()
            .map_err(|e| AppError::Internal(format!("Invalid bind address: {e}")))?;

        let mut endpoint = quinn::Endpoint::server(server_config, addr)
            .map_err(|e| AppError::Internal(format!("Failed to create QUIC endpoint: {e}")))?;

        endpoint.set_default_client_config(client_config);

        let local = endpoint.local_addr()
            .map_err(|e| AppError::Internal(format!("Failed to get local addr: {e}")))?;

        tracing::info!(addr = %local, "QUIC endpoint bound");

        *self.endpoint.write().await = Some(endpoint);
        *self.local_addr.write().await = Some(local);
        Ok(())
    }

    /// Accept an incoming QUIC connection.
    pub async fn accept(&self) -> Result<quinn::Connection, AppError> {
        let endpoint = self.endpoint.read().await;
        let endpoint = endpoint.as_ref().ok_or_else(|| {
            AppError::Internal("QUIC endpoint not bound".into())
        })?;

        let incoming = endpoint.accept().await.ok_or_else(|| {
            AppError::Internal("QUIC endpoint closed".into())
        })?;

        incoming.await.map_err(|e| {
            AppError::Internal(format!("Failed to accept QUIC connection: {e}"))
        })
    }

    /// Connect to a remote peer.
    pub async fn connect(&self, addr: SocketAddr) -> Result<quinn::Connection, AppError> {
        let endpoint = self.endpoint.read().await;
        let endpoint = endpoint.as_ref().ok_or_else(|| {
            AppError::Internal("QUIC endpoint not bound".into())
        })?;

        // Use "personas" as the server name (SNI) — our verifier ignores it
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
    let cert = cert_params.self_signed(&key_pair)
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
            .map_err(|e| AppError::Internal(format!("QUIC server config error: {e}")))?
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
            .map_err(|e| AppError::Internal(format!("QUIC client config error: {e}")))?
    ));

    Ok((server_config, client_config))
}

/// Custom certificate verifier that accepts all server certificates.
/// We rely on the Hello/HelloAck protocol-level handshake to verify peer identity.
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

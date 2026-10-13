#[cfg(feature = "p2p")]
pub mod bundle;
#[cfg(feature = "p2p")]
pub mod discovery;
#[cfg(feature = "p2p")]
pub mod enclave;
#[cfg(feature = "p2p")]
pub mod exposure;
#[cfg(feature = "p2p")]
pub mod identity;
#[cfg(feature = "p2p")]
pub mod owned_devices;
#[cfg(feature = "p2p")]
pub mod pairing;
#[cfg(feature = "p2p")]
pub mod remote_jobs;
// Registered in every build (bodies gate on `p2p`), so a lite build answers
// "not in this build" instead of "command not found".
pub mod remote_sessions;
// Device mesh (spark device-mesh). Registered in every build like
// remote_sessions; bodies gate on `p2p`.
pub mod mesh;

//! Embedding manager for vector knowledge bases.
//!
//! Wraps `fastembed` to provide lazy model loading, batch embedding, and
//! automatic unloading after an idle timeout to reclaim memory.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use tokio::sync::RwLock;

use crate::error::AppError;

/// Idle timeout before the model is unloaded from memory.
const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Manages a lazily-loaded embedding model with automatic idle unloading.
pub struct EmbeddingManager {
    /// Wrapped in an inner `Arc` so in-flight inference keeps the model alive
    /// even after the idle unloader sets the slot to `None`.
    model: Arc<RwLock<Option<Arc<TextEmbedding>>>>,
    last_used: Arc<RwLock<Instant>>,
    cache_dir: PathBuf,
    /// True while an idle-unloader task is running. Prevents duplicate spawns.
    unloader_active: Arc<AtomicBool>,
}

impl EmbeddingManager {
    /// Create a new manager. The model is not loaded until first use.
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            model: Arc::new(RwLock::new(None)),
            last_used: Arc::new(RwLock::new(Instant::now())),
            cache_dir,
            unloader_active: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Embedding dimensions for the current model (AllMiniLML6V2Q = 384).
    pub fn dimensions(&self) -> usize {
        384
    }

    /// Model name identifier.
    pub fn model_name(&self) -> &str {
        "AllMiniLML6V2Q"
    }

    /// Embed a single query string.
    pub async fn embed_query(&self, text: &str) -> Result<Vec<f32>, AppError> {
        let batch = self.embed_batch(&[text.to_string()]).await?;
        batch
            .into_iter()
            .next()
            .ok_or_else(|| AppError::Internal("Embedding returned empty result".into()))
    }

    /// Embed a batch of text strings. Returns vectors in the same order.
    pub async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, AppError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        self.ensure_loaded().await?;

        // Acquire a strong reference to the model while holding the read lock.
        // This ensures the model stays alive for the duration of inference even
        // if the idle-unloader fires and sets the slot to `None` concurrently.
        let model_ref = {
            let guard = self.model.read().await;
            Arc::clone(guard.as_ref().ok_or_else(|| {
                AppError::Internal("Model not loaded after ensure_loaded".into())
            })?)
        };

        // Update last-used timestamp
        {
            let mut ts = self.last_used.write().await;
            *ts = Instant::now();
        }

        let texts_owned = texts.to_vec();

        // Run CPU-bound ONNX inference on a blocking thread to avoid starving the tokio runtime.
        // `model_ref` is an owned Arc — no lock is held across the spawn boundary.
        tokio::task::spawn_blocking(move || {
            model_ref
                .embed(texts_owned, None)
                .map_err(|e| AppError::Internal(format!("Embedding failed: {e}")))
        })
        .await
        .map_err(|e| AppError::Internal(format!("Embedding task panicked: {e}")))?
    }

    /// Ensure the model is loaded. Downloads on first use (~23MB).
    async fn ensure_loaded(&self) -> Result<(), AppError> {
        // Fast path: already loaded
        {
            let guard = self.model.read().await;
            if guard.is_some() {
                return Ok(());
            }
        }

        // Slow path: load model
        let mut guard = self.model.write().await;
        // Double-check after acquiring write lock
        if guard.is_some() {
            return Ok(());
        }

        tracing::info!(
            cache_dir = %self.cache_dir.display(),
            "Loading embedding model AllMiniLML6V2Q (first use may download ~23MB)"
        );

        let cache_dir = self.cache_dir.clone();
        std::fs::create_dir_all(&cache_dir)?;

        // Load model on blocking thread (ONNX init is CPU-bound)
        let model = tokio::task::spawn_blocking(move || {
            TextEmbedding::try_new(
                InitOptions::new(EmbeddingModel::AllMiniLML6V2Q).with_cache_dir(cache_dir),
            )
        })
        .await
        .map_err(|e| AppError::Internal(format!("Model loading task panicked: {e}")))?
        .map_err(|e| AppError::Internal(format!("Failed to load embedding model: {e}")))?;

        tracing::info!("Embedding model loaded successfully");
        *guard = Some(Arc::new(model));

        // Start idle unloader
        self.start_idle_unloader();

        Ok(())
    }

    /// Unload the model from memory.
    pub async fn unload(&self) {
        let mut guard = self.model.write().await;
        if guard.is_some() {
            *guard = None;
            tracing::info!("Embedding model unloaded (idle timeout)");
        }
    }

    /// Spawn a background task that unloads the model after idle timeout.
    /// No-op if an unloader task is already running.
    fn start_idle_unloader(&self) {
        // Bail out if an unloader is already active
        if self.unloader_active.swap(true, Ordering::SeqCst) {
            return;
        }

        let model = Arc::clone(&self.model);
        let last_used = Arc::clone(&self.last_used);
        let active_flag = Arc::clone(&self.unloader_active);

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;

                let elapsed = {
                    let ts = last_used.read().await;
                    ts.elapsed()
                };

                if elapsed >= IDLE_TIMEOUT {
                    let mut guard = model.write().await;
                    // Re-check last_used after acquiring the write lock to avoid
                    // TOCTOU race: a new embed_batch may have updated last_used
                    // between our elapsed check and acquiring this lock.
                    let fresh_elapsed = {
                        let ts = last_used.read().await;
                        ts.elapsed()
                    };
                    if fresh_elapsed < IDLE_TIMEOUT {
                        // Model was used recently — skip unload, keep checking
                        drop(guard);
                        continue;
                    }
                    if guard.is_some() {
                        *guard = None;
                        tracing::info!("Embedding model unloaded after {:?} idle", fresh_elapsed);
                    }
                    break;
                }
            }
            // Allow a new unloader to be spawned on next load
            active_flag.store(false, Ordering::SeqCst);
        });
    }
}

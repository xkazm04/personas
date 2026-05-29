//! Thin Supabase PostgREST client for the desktop → cloud sync writer.
//!
//! Authenticates with the PUBLIC anon key + the signed-in user's Google-OAuth
//! Supabase JWT. Isolation is enforced server-side by Row-Level Security keyed
//! on `auth.uid()` — no secret is hidden in this binary; the anon key is public
//! by design (it's the same key the web app ships in every page).

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::AppError;

/// Max rows per PostgREST request. Keeps individual upserts bounded even on a
/// large first backfill; the writer chunks larger batches across requests.
const CHUNK: usize = 500;

/// Resolve the Supabase project URL. Mirrors the resolution in
/// `commands/infrastructure/auth.rs` (compile-time `SUPABASE_URL` forwarded by
/// `build.rs`, falling back to the runtime env var) so this module stays
/// self-contained. Trailing slash trimmed so path joins are clean.
fn supabase_url() -> Result<String, AppError> {
    if let Some(url) = option_env!("SUPABASE_URL") {
        if !url.is_empty() {
            return Ok(url.trim_end_matches('/').to_string());
        }
    }
    std::env::var("SUPABASE_URL")
        .map(|u| u.trim_end_matches('/').to_string())
        .map_err(|_| AppError::Cloud("SUPABASE_URL not configured for cloud sync".into()))
}

/// Resolve the Supabase anon (publishable) key.
fn supabase_anon_key() -> Result<String, AppError> {
    if let Some(key) = option_env!("SUPABASE_ANON_KEY") {
        if !key.is_empty() {
            return Ok(key.to_string());
        }
    }
    std::env::var("SUPABASE_ANON_KEY")
        .map_err(|_| AppError::Cloud("SUPABASE_ANON_KEY not configured for cloud sync".into()))
}

/// A request-scoped PostgREST client bound to one user's JWT.
pub struct SyncClient {
    http: reqwest::Client,
    rest_base: String,
    anon_key: String,
    jwt: String,
}

impl SyncClient {
    /// Build a client for the given user JWT. Reuses the shared HTTP pool.
    pub fn new(jwt: String) -> Result<Self, AppError> {
        Ok(Self {
            http: crate::SHARED_HTTP.clone(),
            rest_base: format!("{}/rest/v1", supabase_url()?),
            anon_key: supabase_anon_key()?,
            jwt,
        })
    }

    /// Upsert rows into `table`, merging on the primary key. No-op for an empty
    /// slice. Batches larger inputs into `CHUNK`-sized requests.
    pub async fn upsert<T: Serialize>(&self, table: &str, rows: &[T]) -> Result<(), AppError> {
        if rows.is_empty() {
            return Ok(());
        }
        let url = format!("{}/{}", self.rest_base, table);
        for chunk in rows.chunks(CHUNK) {
            let resp = self
                .http
                .post(&url)
                .header("apikey", &self.anon_key)
                .bearer_auth(&self.jwt)
                .header("Content-Type", "application/json")
                // merge-duplicates = upsert on PK; return=minimal skips the echo body.
                .header("Prefer", "resolution=merge-duplicates,return=minimal")
                .json(chunk)
                .send()
                .await
                .map_err(|e| AppError::Cloud(format!("cloud sync POST {table}: {e}")))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(AppError::Cloud(format!(
                    "cloud sync upsert {table} failed: {status} {body}"
                )));
            }
        }
        Ok(())
    }

    /// GET a PostgREST path (table + query string) and deserialize the JSON array.
    pub async fn get<T: DeserializeOwned>(&self, path_and_query: &str) -> Result<T, AppError> {
        let resp = self
            .http
            .get(format!("{}/{}", self.rest_base, path_and_query))
            .header("apikey", &self.anon_key)
            .bearer_auth(&self.jwt)
            .send()
            .await
            .map_err(|e| AppError::Cloud(format!("cloud GET {path_and_query}: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Cloud(format!(
                "cloud GET {path_and_query} failed: {status} {body}"
            )));
        }
        resp.json()
            .await
            .map_err(|e| AppError::Cloud(format!("cloud GET {path_and_query} decode: {e}")))
    }

    /// PATCH rows matching a PostgREST path/query with the given JSON body.
    pub async fn patch<B: Serialize>(
        &self,
        path_and_query: &str,
        body: &B,
    ) -> Result<(), AppError> {
        let resp = self
            .http
            .patch(format!("{}/{}", self.rest_base, path_and_query))
            .header("apikey", &self.anon_key)
            .bearer_auth(&self.jwt)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .json(body)
            .send()
            .await
            .map_err(|e| AppError::Cloud(format!("cloud PATCH {path_and_query}: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Cloud(format!(
                "cloud PATCH {path_and_query} failed: {status} {body}"
            )));
        }
        Ok(())
    }

    /// DELETE rows matching a PostgREST path/query (e.g.
    /// `synced_executions?persona_id=eq.<id>`). RLS still scopes the delete to
    /// the authenticated user's rows. Idempotent — deleting nothing is success.
    pub async fn delete(&self, path_and_query: &str) -> Result<(), AppError> {
        let resp = self
            .http
            .delete(format!("{}/{}", self.rest_base, path_and_query))
            .header("apikey", &self.anon_key)
            .bearer_auth(&self.jwt)
            .header("Prefer", "return=minimal")
            .send()
            .await
            .map_err(|e| AppError::Cloud(format!("cloud DELETE {path_and_query}: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Cloud(format!(
                "cloud DELETE {path_and_query} failed: {status} {body}"
            )));
        }
        Ok(())
    }
}

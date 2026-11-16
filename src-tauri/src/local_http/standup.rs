//! The `/companion/standup` DOORS (spark app-standup): how the terminal
//! standup (`/athena --standup`) becomes a client of the app's one plan while
//! the app runs, instead of keeping a second plan in files.
//!
//! | route | handler | the one call it adapts |
//! |---|---|---|
//! | `GET   /companion/standup/current` | [`current`] | `standup::service::current` |
//! | `POST  /companion/standup/open`    | [`open`]    | `standup::service::open` |
//! | `PATCH /companion/standup/item`    | [`item`]    | `standup::service::update_item` |
//! | `POST  /companion/standup/arm`     | [`arm`]     | `standup::service::arm` |
//! | `POST  /companion/standup/end`     | [`end`]     | `standup::service::end` |
//!
//! Bodies are camelCase: `item` takes `{standupId, patch}` (the
//! `StandupItemPatch` wire shape), `arm` and `end` take `{standupId}`. Answers
//! are the `Standup` wire shape (`current` answers `null` when none is live);
//! refusals are `{ error, code }` (400 `bad_request`, 404 `not_found`, 500
//! `internal`).
//!
//! Authentication: nothing here authenticates. `local_http::start` wraps the
//! whole composed router in `auth::guard` (Host allowlist + the local token
//! from the `~/.personas/local-http.json` handshake), and `companion` is not on
//! `SELF_AUTHENTICATED_PREFIXES`.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::companion::standup::{service, Standup, StandupItemPatch};
use crate::error::AppError;

/// The prefix the router is registered under (`boot::services`).
pub const PREFIX: &str = "companion";

/// The doors' routes over the app.
pub fn router(app: AppHandle) -> Router {
    routes().with_state(DoorState { app: Some(app) })
}

fn routes() -> Router<DoorState> {
    Router::new()
        .route("/standup/current", get(current))
        .route("/standup/open", post(open))
        .route("/standup/item", patch(item))
        .route("/standup/arm", post(arm))
        .route("/standup/end", post(end))
}

/// The handlers' state: the app, which only the route tests leave out.
#[derive(Clone)]
struct DoorState {
    app: Option<AppHandle>,
}

impl DoorState {
    fn app(&self) -> Result<&AppHandle, DoorError> {
        self.app.as_ref().ok_or_else(|| DoorError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal",
            error: "app not ready".into(),
        })
    }
}

/// A refusal. Serialises as `{ error, code }`.
#[derive(Debug)]
struct DoorError {
    status: StatusCode,
    code: &'static str,
    error: String,
}

impl From<AppError> for DoorError {
    fn from(e: AppError) -> Self {
        let error = e.to_string();
        let (status, code) = match e {
            AppError::Validation(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        };
        Self {
            status,
            code,
            error,
        }
    }
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
    code: &'a str,
}

impl IntoResponse for DoorError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: &self.error,
                code: self.code,
            }),
        )
            .into_response()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ItemBody {
    standup_id: String,
    patch: StandupItemPatch,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdBody {
    standup_id: String,
}

fn id_ok(id: &str) -> Result<&str, DoorError> {
    let id = id.trim();
    if id.is_empty() || id.len() > 64 {
        return Err(DoorError {
            status: StatusCode::BAD_REQUEST,
            code: "bad_request",
            error: "standupId must be a non-empty id".into(),
        });
    }
    Ok(id)
}

/// `GET /companion/standup/current`.
async fn current(State(s): State<DoorState>) -> Result<Json<Option<Standup>>, DoorError> {
    Ok(Json(service::current(s.app()?).await?))
}

/// `POST /companion/standup/open`.
async fn open(State(s): State<DoorState>) -> Result<Json<Standup>, DoorError> {
    Ok(Json(service::open(s.app()?).await?))
}

/// `PATCH /companion/standup/item` with `{standupId, patch}`.
async fn item(
    State(s): State<DoorState>,
    Json(b): Json<ItemBody>,
) -> Result<Json<Standup>, DoorError> {
    let id = id_ok(&b.standup_id)?.to_string();
    Ok(Json(service::update_item(s.app()?, &id, b.patch).await?))
}

/// `POST /companion/standup/arm` with `{standupId}`.
async fn arm(
    State(s): State<DoorState>,
    Json(b): Json<IdBody>,
) -> Result<Json<Standup>, DoorError> {
    let id = id_ok(&b.standup_id)?.to_string();
    Ok(Json(service::arm(s.app()?, &id).await?))
}

/// `POST /companion/standup/end` with `{standupId}`.
async fn end(
    State(s): State<DoorState>,
    Json(b): Json<IdBody>,
) -> Result<Json<Standup>, DoorError> {
    let id = id_ok(&b.standup_id)?.to_string();
    Ok(Json(service::end(s.app()?, &id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn serve() -> (String, tokio::task::JoinHandle<()>) {
        let (app, _) = crate::local_http::build_app(vec![(
            PREFIX.to_string(),
            routes().with_state(DoorState { app: None }),
        )]);
        let listener = tokio::net::TcpListener::bind(std::net::SocketAddrV4::new(
            std::net::Ipv4Addr::LOCALHOST,
            0,
        ))
        .await
        .expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (format!("http://127.0.0.1:{port}/companion/standup"), task)
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client")
    }

    #[tokio::test]
    async fn without_the_token_no_standup_door_reaches_a_handler() {
        let (base, task) = serve().await;
        let id = serde_json::json!({ "standupId": "stu_1" });
        for res in [
            client().get(format!("{base}/current")).send().await,
            client().post(format!("{base}/open")).send().await,
            client()
                .patch(format!("{base}/item"))
                .json(&serde_json::json!({ "standupId": "stu_1", "patch": { "id": "sti_1" } }))
                .send()
                .await,
            client().post(format!("{base}/arm")).json(&id).send().await,
            client().post(format!("{base}/end")).json(&id).send().await,
        ] {
            assert_eq!(res.unwrap().status(), reqwest::StatusCode::UNAUTHORIZED);
        }
        task.abort();
    }

    #[tokio::test]
    async fn with_the_token_the_doors_answer_and_bad_bodies_are_refused() {
        let (base, task) = serve().await;
        let authed = |rb: reqwest::RequestBuilder| {
            rb.header(
                crate::local_http::auth::TOKEN_HEADER,
                crate::local_http::auth::local_token(),
            )
        };
        // Past the guard: the handler runs (no app in a unit test -> 500 internal).
        let res = authed(client().get(format!("{base}/current")))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::INTERNAL_SERVER_ERROR);
        let body: serde_json::Value = res.json().await.unwrap();
        assert_eq!(body["code"], "internal");
        // An unknown field and a blank id are refused before any work.
        let res = authed(client().post(format!("{base}/arm")))
            .json(&serde_json::json!({ "standupId": "stu_1", "force": true }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status().as_u16() / 100, 4);
        let res = authed(client().post(format!("{base}/end")))
            .json(&serde_json::json!({ "standupId": "  " }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::BAD_REQUEST);
        task.abort();
    }
}

//! `contest_create`: a new arena through `contest.mjs init`, plus the app
//! sidecar, optionally launched at once.

use std::path::Path;

use tauri::AppHandle;

use super::arena::{self, slugify, spec_string, ArenaPaths, Sidecar};
use super::driver::{self, Ctx};
use super::node::{self, STEP_TIMEOUT};
use super::types::{ContestCreateRequest, ContestSeatKind};
use crate::error::AppError;
use personas_core::validation::{require_at_least_one, require_max_count, require_non_empty};

const MAX_SEATS: usize = 26; // the blind map uses one letter per entry
const MAX_VARIANTS: u32 = 10;
const MAX_TIMEOUT_MIN: u32 = 24 * 60;

/// A free contest id for `title` under the arena (`<slug>`, `<slug>-2`, …).
pub fn free_contest_id(arena_root: &Path, title: &str) -> String {
    let base = match slugify(title) {
        s if s.is_empty() => "contest".to_string(),
        s => s,
    };
    let taken = |id: &str| arena_root.join(id).exists();
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|n| suffixed_id(&base, n))
        .find(|id| !taken(id))
        .unwrap_or(base)
}

/// `<base>-<n>`, cut so it stays a fixed point of the instrument's `slugify`
/// (at most 60 chars, no `--`): `init` re-slugifies `--id`, and a longer id
/// would be cut back onto the taken base.
fn suffixed_id(base: &str, n: u32) -> String {
    let suffix = format!("-{n}");
    let keep = 60usize.saturating_sub(suffix.len());
    let head: String = base.chars().take(keep).collect();
    format!("{}{suffix}", head.trim_end_matches('-'))
}

/// The `init` arguments for a validated request.
pub fn validate(req: &ContestCreateRequest) -> Result<(Vec<String>, Vec<String>), AppError> {
    require_non_empty("title", &req.title)?;
    require_non_empty("brief", &req.brief)?;
    require_at_least_one("seats", &req.seats)?;
    require_max_count("seats", &req.seats, MAX_SEATS)?;
    if req.variants_per_seat == 0 || req.variants_per_seat > MAX_VARIANTS {
        return Err(AppError::Validation(format!(
            "variants per seat must be 1 to {MAX_VARIANTS}"
        )));
    }
    if req.timeout_min == 0 || req.timeout_min > MAX_TIMEOUT_MIN {
        return Err(AppError::Validation(format!(
            "the seat ceiling must be 1 to {MAX_TIMEOUT_MIN} minutes"
        )));
    }
    let seats = req
        .seats
        .iter()
        .map(spec_string)
        .collect::<Result<Vec<_>, _>>()?;
    let judges = req
        .judges
        .iter()
        .map(spec_string)
        .collect::<Result<Vec<_>, _>>()?;
    // A panel switched on must name at least one judge.
    if req.judges_enabled {
        require_at_least_one("judges", &judges)?;
    }
    Ok((seats, judges))
}

pub async fn create(app: &AppHandle, req: ContestCreateRequest) -> Result<Ctx, AppError> {
    let (seats, judges) = validate(&req)?;
    let db = driver::db_of(app)?;
    let project = driver::project(&db, &req.project_id)?;
    let root = Path::new(&project.root_path).to_path_buf();
    if !root.is_dir() {
        return Err(AppError::Validation(format!(
            "project root does not exist: {}",
            root.display()
        )));
    }
    let data_dir = match req
        .data_dir
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        Some(d) => {
            let p = Path::new(d);
            let abs = if p.is_absolute() {
                p.to_path_buf()
            } else {
                root.join(p)
            };
            if !abs.is_dir() {
                return Err(AppError::Validation(format!(
                    "the data folder does not exist: {}",
                    abs.display()
                )));
            }
            Some(abs)
        }
        None => None,
    };
    let instrument = node::require_instrument(&db, &root)?;
    let arena_root = arena::arena_root(&root);
    let contest_id = free_contest_id(&arena_root, &req.title);
    let paths = ArenaPaths::new(&root, &contest_id)?;

    // The brief travels as a file (init reads --brief <file>).
    let brief_file = std::env::temp_dir().join(format!(
        "personas-contest-brief-{}.md",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&brief_file, req.brief.trim())
        .map_err(|e| AppError::Internal(format!("write {}: {e}", brief_file.display())))?;
    let (vault, vault_subdir) = node::resolve_vault(&root);
    let mut args = vec![
        "init".to_string(),
        "--id".into(),
        contest_id.clone(),
        "--title".into(),
        req.title.trim().to_string(),
        "--brief".into(),
        brief_file.to_string_lossy().into_owned(),
        "--participants".into(),
        seats.join(","),
        "--variants".into(),
        req.variants_per_seat.to_string(),
        "--timeout-min".into(),
        req.timeout_min.to_string(),
        "--arena".into(),
        arena_root.to_string_lossy().into_owned(),
        "--vault".into(),
        vault.to_string_lossy().into_owned(),
        "--vault-subdir".into(),
        vault_subdir,
        "--project".into(),
        project.name.clone(),
    ];
    if let Some(d) = &data_dir {
        args.extend(["--data".into(), d.to_string_lossy().into_owned()]);
    }
    let ran = node::run_node_checked(&instrument, &args, &root, STEP_TIMEOUT).await;
    let _ = std::fs::remove_file(&brief_file);
    ran?;

    let sidecar = Sidecar {
        judges_enabled: req.judges_enabled,
        judges,
        not_before_ms: req.not_before_ms,
        ..Sidecar::default()
    };
    let ctx = driver::ctx_for_project(&project, &contest_id)?;
    driver::update_sidecar(&paths, |s| *s = sidecar).await?;
    driver::emit_changed(app, &ctx.project_id, &contest_id);
    if req.launch {
        driver::launch_seats(app, &ctx, ContestSeatKind::Participant, None)
            .await
            .map_err(|e| {
                AppError::Internal(format!(
                    "contest `{contest_id}` was created, but launching its seats failed: {e}"
                ))
            })?;
    }
    Ok(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::contest::types::{ContestEffort, ContestEngine, ContestSeatSpec};

    fn req() -> ContestCreateRequest {
        ContestCreateRequest {
            project_id: "p".into(),
            title: "Home page".into(),
            brief: "## The idea\nx".into(),
            seats: vec![ContestSeatSpec {
                engine: ContestEngine::Claude,
                model: "opus".into(),
                effort: ContestEffort::High,
                label: None,
            }],
            variants_per_seat: 3,
            timeout_min: 60,
            judges_enabled: false,
            judges: vec![],
            data_dir: None,
            not_before_ms: None,
            launch: false,
        }
    }

    #[test]
    fn validation() {
        let (seats, judges) = validate(&req()).unwrap();
        assert_eq!(seats, vec!["claude:opus@high"]);
        assert!(judges.is_empty());
        let mut r = req();
        r.judges_enabled = true;
        assert!(validate(&r).is_err(), "a judge panel with no judge");
        let mut r = req();
        r.variants_per_seat = 0;
        assert!(validate(&r).is_err());
        let mut r = req();
        r.seats.clear();
        assert!(validate(&r).is_err());
        let mut r = req();
        r.seats[0].model = "bad model".into();
        assert!(validate(&r).is_err());
    }

    #[test]
    fn contest_ids_are_free_slugs() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(free_contest_id(tmp.path(), "Home Page!"), "home-page");
        std::fs::create_dir_all(tmp.path().join("home-page")).unwrap();
        std::fs::create_dir_all(tmp.path().join("home-page-2")).unwrap();
        assert_eq!(free_contest_id(tmp.path(), "Home Page!"), "home-page-3");
        assert_eq!(free_contest_id(tmp.path(), "!!!"), "contest");
    }

    /// `init` re-slugifies `--id` (at most 60 chars), so the id must be a
    /// fixed point of `slugify` or init lands on a different (taken) dir.
    #[test]
    fn a_suffixed_id_is_a_fixed_point_of_the_instruments_slugify() {
        let tmp = tempfile::tempdir().unwrap();
        // A 60-char base, and one whose cut would end on a dash.
        for title in ["a".repeat(80), format!("{}-bcdef", "a".repeat(57))] {
            let base = slugify(&title);
            std::fs::create_dir_all(tmp.path().join(&base)).unwrap();
            let id = free_contest_id(tmp.path(), &title);
            assert_ne!(id, base, "the base is taken");
            assert!(id.len() <= 60, "{id} is {} chars", id.len());
            assert_eq!(slugify(&id), id, "init would re-slugify {id}");
            assert!(!tmp.path().join(&id).exists());
        }
    }
}

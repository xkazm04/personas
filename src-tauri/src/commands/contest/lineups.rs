//! Saved seat line-ups: app_settings `contest.lineups`, a JSON array of
//! `{name, seats: [spec]}`.

use super::arena::parse_seat_spec;
use super::types::ContestLineup;
use crate::db::repos::core::settings as settings_repo;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;
use personas_core::validation::require_non_empty;

/// Decode the stored value; absent or blank is no line-ups.
pub fn decode(raw: Option<&str>) -> Result<Vec<ContestLineup>, AppError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(Vec::new()),
        Some(text) => serde_json::from_str(text).map_err(|e| {
            AppError::Internal(format!("contest.lineups is not a line-up array: {e}"))
        }),
    }
}

/// Validate and canonicalise: non-empty unique names, every seat a valid spec.
pub fn normalise(lineups: Vec<ContestLineup>) -> Result<Vec<ContestLineup>, AppError> {
    let mut names = std::collections::BTreeSet::new();
    let mut out = Vec::with_capacity(lineups.len());
    for l in lineups {
        require_non_empty("line-up name", &l.name)?;
        let name = l.name.trim().to_string();
        if !names.insert(name.clone()) {
            return Err(AppError::Validation(format!(
                "line-up `{name}` is named twice"
            )));
        }
        let seats = l
            .seats
            .iter()
            .map(|s| parse_seat_spec(s).map(|p| p.spec))
            .collect::<Result<Vec<_>, _>>()?;
        super::create::require_unique_seat_ids(&format!("line-up `{name}` seat"), &seats)?;
        out.push(ContestLineup { name, seats });
    }
    Ok(out)
}

pub fn get(db: &DbPool) -> Result<Vec<ContestLineup>, AppError> {
    decode(settings_repo::get(db, settings_keys::CONTEST_LINEUPS)?.as_deref())
}

pub fn set(db: &DbPool, lineups: Vec<ContestLineup>) -> Result<(), AppError> {
    let lineups = normalise(lineups)?;
    let json = serde_json::to_string(&lineups)
        .map_err(|e| AppError::Internal(format!("serialize contest.lineups: {e}")))?;
    settings_repo::set(db, settings_keys::CONTEST_LINEUPS, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lineups_roundtrip_through_app_settings() {
        let db = crate::db::init_test_db().unwrap();
        assert!(get(&db).unwrap().is_empty(), "absent is []");
        let lineups = vec![
            ContestLineup {
                name: " Frontier ".into(),
                seats: vec!["claude:opus@xhigh".into(), " grok:grok-4.6@high ".into()],
            },
            ContestLineup {
                name: "Cheap".into(),
                seats: vec![],
            },
        ];
        set(&db, lineups).unwrap();
        let back = get(&db).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].name, "Frontier");
        assert_eq!(
            back[0].seats,
            vec!["claude:opus@xhigh", "grok:grok-4.6@high"]
        );
        set(&db, vec![]).unwrap();
        assert!(get(&db).unwrap().is_empty());
    }

    #[test]
    fn invalid_lineups_are_refused() {
        let bad_spec = vec![ContestLineup {
            name: "x".into(),
            seats: vec!["nope".into()],
        }];
        assert!(normalise(bad_spec).is_err());
        let dup = vec![
            ContestLineup {
                name: "a".into(),
                seats: vec![],
            },
            ContestLineup {
                name: "a ".into(),
                seats: vec![],
            },
        ];
        assert!(normalise(dup).is_err());
        let repeated_seat = vec![ContestLineup {
            name: "x".into(),
            seats: vec!["claude:opus@high".into(), " claude:opus@high".into()],
        }];
        assert!(
            normalise(repeated_seat).is_err(),
            "a seat repeated in one line-up"
        );
        assert!(decode(Some("  ")).unwrap().is_empty());
        assert!(decode(Some("{")).is_err());
    }
}

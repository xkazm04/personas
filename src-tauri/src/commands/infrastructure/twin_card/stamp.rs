//! Timestamps between the database and a card.
//!
//! The twin tables stamp RFC 3339 (`chrono::Utc::now().to_rfc3339()`); the
//! setup-plan tables stamp SQLite `datetime('now')` text
//! (`YYYY-MM-DD HH:MM:SS`, UTC, compared as strings by the snapshot). A card
//! carries RFC 3339 only (SPEC.md 3). The rules here keep a round trip
//! exact: an RFC 3339 value travels verbatim both ways, and a SQLite value
//! becomes whole-second `...Z` text that maps back to the same SQLite text.

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};

const SQLITE_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

/// Any timestamp either kind of table holds, as an instant.
pub(super) fn parse_any(raw: &str) -> Option<DateTime<Utc>> {
    let raw = raw.trim();
    DateTime::parse_from_rfc3339(raw)
        .map(|t| t.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(raw, SQLITE_FORMAT)
                .ok()
                .map(|t| t.and_utc())
        })
}

/// A database timestamp as card text: RFC 3339 verbatim, SQLite text as
/// whole-second UTC (`2026-09-29T17:40:00Z`). `None` when it is neither.
pub(super) fn to_card(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if DateTime::parse_from_rfc3339(trimmed).is_ok() {
        return Some(trimmed.to_string());
    }
    NaiveDateTime::parse_from_str(trimmed, SQLITE_FORMAT)
        .ok()
        .map(|t| t.and_utc().to_rfc3339_opts(SecondsFormat::Secs, true))
}

/// A database timestamp as whole-second UTC card text, so the setup tables
/// (second resolution) can hold it again unchanged.
pub(super) fn to_card_secs(raw: &str) -> Option<String> {
    parse_any(raw).map(|t| t.to_rfc3339_opts(SecondsFormat::Secs, true))
}

/// A card timestamp as setup-table text (`YYYY-MM-DD HH:MM:SS`, UTC).
pub(super) fn to_sqlite(card: &str) -> Option<String> {
    parse_any(card).map(|t| t.format(SQLITE_FORMAT).to_string())
}

/// A card timestamp the twin tables store as given: valid RFC 3339 only.
pub(super) fn rfc3339_verbatim(card: &str) -> Option<String> {
    let trimmed = card.trim();
    DateTime::parse_from_rfc3339(trimmed)
        .ok()
        .map(|_| trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_round_trip_through_a_card_is_exact() {
        let rfc = "2026-09-20T10:00:00.123456789+00:00";
        assert_eq!(to_card(rfc).as_deref(), Some(rfc));
        assert_eq!(rfc3339_verbatim(rfc).as_deref(), Some(rfc));

        let sqlite = "2026-09-29 17:40:00";
        let card = to_card(sqlite).expect("sqlite text converts");
        assert_eq!(card, "2026-09-29T17:40:00Z");
        assert_eq!(to_sqlite(&card).as_deref(), Some(sqlite));
        assert_eq!(to_card_secs(sqlite).as_deref(), Some(card.as_str()));
    }

    #[test]
    fn an_rfc3339_answer_drops_to_whole_seconds_utc() {
        assert_eq!(
            to_card_secs("2026-09-29T19:40:00.75+02:00").as_deref(),
            Some("2026-09-29T17:40:00Z")
        );
        assert_eq!(
            to_sqlite("2026-09-29T19:40:00+02:00").as_deref(),
            Some("2026-09-29 17:40:00")
        );
    }

    #[test]
    fn garbage_is_none() {
        assert_eq!(to_card("yesterday"), None);
        assert_eq!(to_sqlite(""), None);
        assert_eq!(rfc3339_verbatim("2026-09-29 17:40:00"), None);
    }
}

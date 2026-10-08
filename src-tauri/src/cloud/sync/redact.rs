//! Free text on its way to the cloud: token-level secret masking and hard size
//! caps (PHASE2-SPEC section 5 intro).
//!
//! Notes and chat are prose the user typed, or replies that may quote what a
//! persona read through its connectors. `rows::redact_scalar` blanks a whole
//! value when it looks like a credential, which is right for a short label and
//! wrong for prose: one pasted token would erase the paragraph around it.
//! [`redact_text`] instead masks only the tokens that look secret and keeps
//! every other byte, whitespace included, so the text still reads.
//!
//! The order is always mask first, then cap ([`project_text`]): a cap applied
//! first could cut a token in half and leave a prefix the masker no longer
//! recognises.

use super::rows::{key_is_secret, value_looks_secret};

/// What a masked token becomes.
pub const REDACTED: &str = "[redacted]";

/// Appended to a capped text. Counted inside the cap, so a capped text is
/// never longer than the cap.
pub const TRUNCATION_MARKER: &str = "\n[truncated]";

/// `synced_notes.body_md` cap (bytes).
pub const NOTE_BODY_CAP: usize = 16 * 1024;

/// `synced_chat_messages.content` cap (bytes).
pub const CHAT_CONTENT_CAP: usize = 32 * 1024;

/// Cap for short display fields (titles, a note's run summary).
pub const SHORT_TEXT_CAP: usize = 1024;

/// A token shorter than this is never masked by PREFIX alone. The prefix list
/// was written for JSON values, where a value that starts with `sk-` is a key;
/// in prose `sk-learn` or `xoxo` are words. Every real token those prefixes
/// name is far longer (an OpenAI key is 51 characters, a GitHub token 40, an
/// AWS key id 20). The density rule has its own 60-character floor.
const MIN_PREFIX_TOKEN: usize = 16;

/// Characters stripped from both ends of a token before it is judged, and put
/// back after: quotes, brackets and sentence punctuation around a pasted key.
fn is_wrapper(c: char) -> bool {
    matches!(
        c,
        '"' | '\''
            | '`'
            | '('
            | ')'
            | '['
            | ']'
            | '{'
            | '}'
            | '<'
            | '>'
            | ','
            | ';'
            | '.'
            | '!'
            | '?'
    )
}

/// Split `tok` into (leading wrappers, core, trailing wrappers).
fn unwrap_token(tok: &str) -> (&str, &str, &str) {
    let start = tok.len() - tok.trim_start_matches(is_wrapper).len();
    let rest = &tok[start..];
    let core_len = rest.trim_end_matches(is_wrapper).len();
    (&tok[..start], &rest[..core_len], &rest[core_len..])
}

/// Length band of the mixed-case rule: shorter reads as a word or a short id,
/// 60 and over is already caught by the density rule in `value_looks_secret`.
const MIXED_TOKEN_LEN: std::ops::RangeInclusive<usize> = 32..=59;

/// A 32 to 59 character run of ASCII letters and digits with upper case, lower
/// case and a digit all present: the shape of a random base62 key. A UUID has
/// hyphens, a git SHA or a hash is single-case hex, prose has no digits inside
/// its words, so none of those match.
fn looks_mixed_token(core: &str) -> bool {
    MIXED_TOKEN_LEN.contains(&core.len())
        && core.bytes().all(|b| b.is_ascii_alphanumeric())
        && core.bytes().any(|b| b.is_ascii_uppercase())
        && core.bytes().any(|b| b.is_ascii_lowercase())
        && core.bytes().any(|b| b.is_ascii_digit())
}

/// A lowercase hex run of exactly 40 (git SHA) or 64 (sha256) characters. The
/// density rule in `value_looks_secret` reads a 64-character hash as a key; in
/// prose it is far more often a commit or a digest. A hex value under a
/// secret-named key is still masked by [`names_a_secret`].
fn looks_like_hash(core: &str) -> bool {
    matches!(core.len(), 40 | 64)
        && core
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn looks_secret(core: &str) -> bool {
    if looks_like_hash(core) {
        return false;
    }
    (core.len() >= MIN_PREFIX_TOKEN && value_looks_secret(core)) || looks_mixed_token(core)
}

/// `name_with_sep` (a key with its trailing `=` or `:`) names a secret:
/// `DB_PASSWORD=`, `"password":`.
fn names_a_secret(name_with_sep: &str) -> bool {
    key_is_secret(
        name_with_sep
            .trim_end_matches(['=', ':'])
            .trim_matches(is_wrapper),
    )
}

/// Mask one whitespace-free token, or return `None` to keep it as it is.
/// `forced`: the previous token was the word `Bearer`, or a secret-named key
/// with its separator (`password:`), so this one is the credential whatever it
/// looks like.
fn mask_token(tok: &str, forced: bool) -> Option<String> {
    let (lead, core, trail) = unwrap_token(tok);
    if core.is_empty() {
        return None;
    }
    if forced {
        return Some(format!("{lead}{REDACTED}{trail}"));
    }
    let masked = if core.contains("://") {
        mask_url(core)
    } else {
        mask_core(core)
    }?;
    Some(format!("{lead}{masked}{trail}"))
}

/// One unwrapped token. `KEY=value`, `token:value`: mask the value and keep
/// the name, which is what tells the reader what was there. Otherwise the
/// whole token is judged.
fn mask_core(core: &str) -> Option<String> {
    if let Some(i) = core.rfind(['=', ':']) {
        let (name, value) = core.split_at(i + 1);
        let (vlead, vcore, vtrail) = unwrap_token(value);
        if !vcore.is_empty() && (looks_secret(vcore) || names_a_secret(name)) {
            return Some(format!("{name}{vlead}{REDACTED}{vtrail}"));
        }
    }
    looks_secret(core).then(|| REDACTED.to_string())
}

/// A link is judged segment by segment (path parts, query pairs, fragment).
/// Judged whole, any link past 60 characters reads as a dense credential and
/// the reader would lose every long URL; judged by segment, only the part that
/// carries a key goes.
fn mask_url(url: &str) -> Option<String> {
    let (url, mut changed) = match mask_userinfo(url) {
        Some(u) => (u, true),
        None => (url.to_string(), false),
    };
    let mut out = String::with_capacity(url.len());
    for piece in url.split_inclusive(['/', '?', '&', '#']) {
        let (body, sep) = match piece.char_indices().last() {
            Some((i, '/' | '?' | '&' | '#')) => piece.split_at(i),
            _ => (piece, ""),
        };
        match mask_core(body) {
            Some(m) => {
                out.push_str(&m);
                changed = true;
            }
            None => out.push_str(body),
        }
        out.push_str(sep);
    }
    changed.then_some(out)
}

/// The password in `scheme://user:pass@host`: the userinfo is judged by its
/// position, not its look, because a password is any string at all.
fn mask_userinfo(url: &str) -> Option<String> {
    let after_scheme = url.find("://")? + 3;
    let authority_len = url[after_scheme..]
        .find(['/', '?', '#'])
        .unwrap_or(url.len() - after_scheme);
    let authority = &url[after_scheme..after_scheme + authority_len];
    let at = authority.rfind('@')?;
    let (user, password) = authority[..at].split_once(':')?;
    if password.is_empty() || password == REDACTED {
        return None;
    }
    Some(format!(
        "{}{user}:{REDACTED}{}",
        &url[..after_scheme],
        &url[after_scheme + at..]
    ))
}

/// Mask every whitespace-delimited token that looks like a credential
/// ([`value_looks_secret`], with the prose floor above), keeping all other
/// text and all whitespace byte for byte.
pub fn redact_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut after_bearer = false;
    let mut after_secret_key = false;
    let mut rest = s;
    while !rest.is_empty() {
        let ws = rest.len() - rest.trim_start().len();
        out.push_str(&rest[..ws]);
        rest = &rest[ws..];
        if rest.is_empty() {
            break;
        }
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let tok = &rest[..end];
        let core = unwrap_token(tok).1;
        let is_bearer = core.eq_ignore_ascii_case("bearer");
        // `Authorization: Bearer x` keeps its own rule: the word `Bearer` is
        // not itself the credential.
        let forced = after_bearer || (after_secret_key && !is_bearer);
        match mask_token(tok, forced) {
            Some(masked) => out.push_str(&masked),
            None => out.push_str(tok),
        }
        after_bearer = is_bearer;
        after_secret_key = core.ends_with(['=', ':']) && names_a_secret(core);
        rest = &rest[end..];
    }
    out
}

/// Cap `s` at `max` bytes, cutting on a char boundary and ending with
/// [`TRUNCATION_MARKER`]; the result is never longer than `max`.
pub fn cap_bytes(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut cut = max.saturating_sub(TRUNCATION_MARKER.len());
    while cut > 0 && !s.is_char_boundary(cut) {
        cut -= 1;
    }
    let mut out = String::with_capacity(cut + TRUNCATION_MARKER.len());
    out.push_str(&s[..cut]);
    out.push_str(TRUNCATION_MARKER);
    out
}

/// The one door free text takes to the cloud: mask, then cap.
pub fn project_text(s: &str, max: usize) -> String {
    cap_bytes(redact_text(s), max)
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPENAI: &str = "sk-proj-4f8Kq2Lx9Vb7Nm3Zt6Wy1Rc5Hd0Jg2Pa8Se4Uf"; // gitleaks:allow
    const GITHUB: &str = "ghp_16C7e42F292c6912E7710c838347Ae178B4a"; // gitleaks:allow

    #[test]
    fn a_secret_inside_prose_is_masked_and_the_prose_survives() {
        let text = format!("Deploy failed. I used {OPENAI} for the call, then retried twice.");
        let out = redact_text(&text);
        assert_eq!(
            out,
            "Deploy failed. I used [redacted] for the call, then retried twice."
        );
        assert!(!out.contains("sk-proj"));
    }

    #[test]
    fn wrappers_stay_and_only_the_token_goes() {
        let out = redact_text(&format!("The key (\"{GITHUB}\"), see above."));
        assert_eq!(out, "The key (\"[redacted]\"), see above.");
    }

    #[test]
    fn a_named_value_keeps_its_name() {
        let out = redact_text(&format!("export GITHUB_TOKEN={GITHUB}\nnext line"));
        assert_eq!(out, "export GITHUB_TOKEN=[redacted]\nnext line");
        let url = format!("https://api.example.com/v1?access_token={OPENAI}&page=2");
        assert_eq!(
            redact_text(&url),
            "https://api.example.com/v1?access_token=[redacted]&page=2"
        );
    }

    #[test]
    fn a_long_link_without_a_key_is_kept() {
        let link = "See https://docs.example.com/guides/getting-started/installation/windows-and-macos#prerequisites now";
        assert_eq!(redact_text(link), link);
        let with_key = format!("https://github.com/{GITHUB}/repo");
        assert_eq!(redact_text(&with_key), "https://github.com/[redacted]/repo");
    }

    #[test]
    fn the_word_after_bearer_is_masked_whatever_it_looks_like() {
        let out = redact_text("Authorization: Bearer abc123 was sent");
        assert_eq!(out, "Authorization: Bearer [redacted] was sent");
    }

    #[test]
    fn a_jwt_and_a_long_dense_run_are_masked() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"; // gitleaks:allow
        assert_eq!(redact_text(jwt), REDACTED);
        let dense = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAx"; // gitleaks:allow
        assert_eq!(redact_text(&format!("blob: {dense}")), "blob: [redacted]");
    }

    #[test]
    fn ordinary_words_that_share_a_prefix_are_kept() {
        let text = "We use sk-learn and xoxo, AKIA is a name, eyJ alone is nothing.";
        assert_eq!(redact_text(text), text);
    }

    #[test]
    fn a_secret_named_key_in_prose_masks_its_value() {
        assert_eq!(
            redact_text("set DB_PASSWORD=hunter2 and retry"),
            "set DB_PASSWORD=[redacted] and retry"
        );
        assert_eq!(
            redact_text("the password: hunter2 was reused"),
            "the password: [redacted] was reused"
        );
        assert_eq!(
            redact_text(r#"{"client_secret":"abc"}"#),
            r#"{"client_secret":"[redacted]"}"#
        );
        // A key that is not secret-named keeps its value.
        assert_eq!(
            redact_text("name=alice mode: fast"),
            "name=alice mode: fast"
        );
    }

    #[test]
    fn the_password_in_url_userinfo_is_masked() {
        assert_eq!(
            redact_text("connect postgres://admin:hunter2@db.internal:5432/app now"),
            "connect postgres://admin:[redacted]@db.internal:5432/app now"
        );
        let plain = "see https://user@example.com/path and https://example.com:8080/x";
        assert_eq!(redact_text(plain), plain);
    }

    #[test]
    fn newer_token_prefixes_are_masked() {
        for tok in [
            "AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvW", // gitleaks:allow
            "npm_aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5", // gitleaks:allow
            "hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789", // gitleaks:allow
            "rk_live_4eC39HqLyjWDarjtT1zdp7dc",        // gitleaks:allow
            "rk_test_4eC39HqLyjWDarjtT1zdp7dc",        // gitleaks:allow
            "whsec_8f2a1b3c4d5e6f708192a3b4c5d6e7f8",  // gitleaks:allow
            "shpat_0123456789abcdef0123456789abcdef",  // gitleaks:allow
            "glsa_AbCdEfGhIjKlMnOpQrStUvWxYz012345_0a1b2c3d", // gitleaks:allow
            "xapp-1-A0123456789-1234567890123-abcdef0123456789", // gitleaks:allow
        ] {
            assert_eq!(
                redact_text(&format!("key {tok} end")),
                "key [redacted] end",
                "{tok}"
            );
        }
    }

    #[test]
    fn a_mixed_case_digit_run_of_key_length_is_masked() {
        let tok = "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE"; // gitleaks:allow
        assert_eq!(tok.len(), 32);
        assert_eq!(
            redact_text(&format!("value {tok} here")),
            "value [redacted] here"
        );
    }

    #[test]
    fn identifiers_hashes_and_prose_stay_intact() {
        let text = "id 6f1d2c3b-4a59-4e68-9d7c-0b1a2c3d4e5f commit \
            9fceb02d0ae598e95dc970b74767f19372d61af8 sha \
            e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 \
            and the quick brown fox jumps over the lazy dog, twice daily.";
        assert_eq!(redact_text(text), text);
    }

    #[test]
    fn whitespace_is_kept_byte_for_byte() {
        let text = "  two  spaces\n\n\ttab and trailing  ";
        assert_eq!(redact_text(text), text);
        assert_eq!(redact_text(""), "");
    }

    /// The shared redaction cases. `personas-web` keeps a byte-identical copy
    /// and masks a say with the same rules before it signs it, so a case
    /// changed here is a change on both sides.
    const FIXTURE: &str = include_str!("../../../../fixtures/redact-text-v1.json");

    #[test]
    fn every_shared_fixture_case_holds() {
        assert!(
            !FIXTURE.contains('\r'),
            "the fixture is copied byte for byte: keep it LF"
        );
        let doc: serde_json::Value = serde_json::from_str(FIXTURE).expect("fixture is JSON");
        assert_eq!(doc["version"], 1);
        let cases = doc["cases"].as_array().expect("cases is an array");
        assert!(!cases.is_empty());
        let mut names = std::collections::HashSet::new();
        let mut failures = Vec::new();
        for case in cases {
            let field = |k: &str| {
                case[k]
                    .as_str()
                    .unwrap_or_else(|| panic!("case {case} has no string {k:?}"))
            };
            let (name, input, expected) = (field("name"), field("input"), field("expected"));
            assert!(names.insert(name), "duplicate case name {name:?}");
            let got = redact_text(input);
            if got != expected {
                failures.push(format!(
                    "{name}\n  input:    {input:?}\n  expected: {expected:?}\n  got:      {got:?}"
                ));
            }
        }
        assert!(
            failures.is_empty(),
            "{} of {} fixture cases failed:\n{}",
            failures.len(),
            cases.len(),
            failures.join("\n")
        );
    }

    #[test]
    fn cap_is_a_no_op_under_the_limit() {
        assert_eq!(cap_bytes("short".into(), 16), "short");
        assert_eq!(cap_bytes("x".repeat(16), 16), "x".repeat(16));
    }

    #[test]
    fn cap_truncates_with_the_marker_and_never_exceeds_the_limit() {
        let out = cap_bytes("a".repeat(100), 40);
        assert!(out.len() <= 40, "{}", out.len());
        assert!(out.ends_with(TRUNCATION_MARKER));
        assert!(out.starts_with("aaaa"));
    }

    #[test]
    fn cap_cuts_on_a_char_boundary() {
        // 'é' is two bytes: a cut landing inside one must step back.
        let s = "é".repeat(50);
        for max in 20..30 {
            let out = cap_bytes(s.clone(), max);
            assert!(out.len() <= max);
            assert!(out.ends_with(TRUNCATION_MARKER));
        }
    }

    #[test]
    fn project_text_masks_before_it_caps() {
        // The secret sits across the cap: masking first means no prefix of it
        // can survive the cut.
        let text = format!("{}{OPENAI}", "a ".repeat(10));
        let out = project_text(&text, 30);
        assert!(!out.contains("sk-"), "{out}");
        assert_eq!(
            project_text(&format!("note {GITHUB}"), NOTE_BODY_CAP),
            "note [redacted]"
        );
    }
}

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

use super::rows::value_looks_secret;

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

fn looks_secret(core: &str) -> bool {
    core.len() >= MIN_PREFIX_TOKEN && value_looks_secret(core)
}

/// Mask one whitespace-free token, or return `None` to keep it as it is.
/// `after_bearer`: the previous token was the word `Bearer`, so this one is
/// the credential whatever it looks like.
fn mask_token(tok: &str, after_bearer: bool) -> Option<String> {
    let (lead, core, trail) = unwrap_token(tok);
    if core.is_empty() {
        return None;
    }
    if after_bearer {
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
        if !vcore.is_empty() && looks_secret(vcore) {
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
    let mut out = String::with_capacity(url.len());
    let mut changed = false;
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

/// Mask every whitespace-delimited token that looks like a credential
/// ([`value_looks_secret`], with the prose floor above), keeping all other
/// text and all whitespace byte for byte.
pub fn redact_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut after_bearer = false;
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
        match mask_token(tok, after_bearer) {
            Some(masked) => out.push_str(&masked),
            None => out.push_str(tok),
        }
        after_bearer = unwrap_token(tok).1.eq_ignore_ascii_case("bearer");
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
    fn whitespace_is_kept_byte_for_byte() {
        let text = "  two  spaces\n\n\ttab and trailing  ";
        assert_eq!(redact_text(text), text);
        assert_eq!(redact_text(""), "");
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

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

/// Whether a value is already the [`REDACTED`] marker, so masking it again
/// would only nest it (`[[redacted]]`). The rule, in plain sentences: after the
/// value's wrappers are split off, the core is exactly the word `redacted`, and
/// the leading wrappers end with `[`. The trailing wrappers are not looked at,
/// because an outer unwrap may already have taken the closing `]` (in
/// `{"client_secret":"[redacted]"}` the value reaches this check as
/// `"[redacted`). `redacted` with no bracket, or with any other character
/// stuck to it (`[redacted]hunter2` has the core `redacted]hunter2`), is not
/// the marker and is masked as before. The check applies wherever `REDACTED`
/// would replace a value: both branches of `mask_core` and the forced branch
/// of `mask_token`. A value that is the marker stays byte for byte.
fn is_marker(lead: &str, core: &str) -> bool {
    core == "redacted" && lead.ends_with('[')
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

/// A bare 40-character base64 run holding `+` or `/`, with upper case, lower
/// case and a digit: the shape of an AWS secret access key. The mixed-case
/// rule already takes such a key when it happens to be all letters and
/// digits; this one takes the rest.
///
/// The shape alone also fits a relative path (`docs/Guides/Setup2/...`), so
/// one more test tells them apart: the mean length of the lowercase runs. In
/// a random base64 key a lowercase letter is followed by another with odds
/// 26 in 64, so runs average 1.7 letters; path segments and identifiers are
/// words, and average 4 and more. Measured 2026-10-08: under 2.5 takes 97% of
/// random keys of this shape, no 40-character path-shaped token in this repo
/// (164 of them, lowest mean 4.4), and 0.02% of 200,000 random word-salad
/// paths built from the repo's own file and folder names.
fn looks_bare_cloud_key(core: &str) -> bool {
    let b = core.as_bytes();
    if b.len() != 40
        || !b
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/')
        || !b.iter().any(|&c| c == b'+' || c == b'/')
        || !b.iter().any(u8::is_ascii_uppercase)
        || !b.iter().any(u8::is_ascii_lowercase)
        || !b.iter().any(u8::is_ascii_digit)
    {
        return false;
    }
    let (mut lower, mut runs, mut in_run) = (0usize, 0usize, false);
    for c in b {
        let is_lower = c.is_ascii_lowercase();
        if is_lower {
            lower += 1;
            runs += usize::from(!in_run);
        }
        in_run = is_lower;
    }
    // Mean run length under 2.5, in integers so the web port matches exactly.
    2 * lower < 5 * runs
}

fn looks_secret(core: &str) -> bool {
    if looks_like_hash(core) {
        return false;
    }
    (core.len() >= MIN_PREFIX_TOKEN && value_looks_secret(core))
        || looks_mixed_token(core)
        || looks_bare_cloud_key(core)
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
        if is_marker(lead, core) {
            return None;
        }
        return Some(format!("{lead}{REDACTED}{trail}"));
    }
    let masked = if core.contains("://") {
        mask_url(core)
    } else {
        mask_pairs(core)
    }?;
    Some(format!("{lead}{masked}{trail}"))
}

/// Split a piece produced by `split_inclusive` into (body, separator).
fn split_sep<'a>(piece: &'a str, seps: &[char]) -> (&'a str, &'a str) {
    match piece.char_indices().last() {
        Some((i, c)) if seps.contains(&c) => piece.split_at(i),
        _ => (piece, ""),
    }
}

/// Pairs joined in one token, `Server=db;Password=x` or `a=1&secret=y`, are
/// judged pair by pair: judged whole, the name before the LAST `=` runs back
/// over every pair, so the password stayed and the database name was masked.
/// The separators and every pair that is not a secret stay byte for byte. A
/// token with no `key=value` piece is judged whole, as before.
fn mask_pairs(core: &str) -> Option<String> {
    const SEPS: [char; 2] = [';', '&'];
    let bodies = || {
        core.split_inclusive(SEPS)
            .map(|p| split_sep(p, &SEPS).0)
            .filter(|b| !b.is_empty())
    };
    if bodies().count() < 2 || !bodies().any(|b| b.contains(['=', ':'])) {
        return mask_core(core);
    }
    let mut out = String::with_capacity(core.len());
    let mut changed = false;
    for piece in core.split_inclusive(SEPS) {
        let (body, sep) = split_sep(piece, &SEPS);
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

/// One unwrapped token. `KEY=value`, `token:value`: mask the value and keep
/// the name, which is what tells the reader what was there. Otherwise the
/// whole token is judged.
///
/// The value of a secret-named key starts at the FIRST separator that ends
/// the name, so a password that itself holds `=` or `:` (base64 padding,
/// `user:pass`) goes whole. Any other value is the part after the last one.
fn mask_core(core: &str) -> Option<String> {
    for (i, _) in core.match_indices(['=', ':']) {
        let (name, value) = core.split_at(i + 1);
        let (vlead, vcore, vtrail) = unwrap_token(value);
        if !vcore.is_empty() && names_a_secret(name) {
            if is_marker(vlead, vcore) {
                return None;
            }
            return Some(format!("{name}{vlead}{REDACTED}{vtrail}"));
        }
    }
    if let Some(i) = core.rfind(['=', ':']) {
        let (name, value) = core.split_at(i + 1);
        let (vlead, vcore, vtrail) = unwrap_token(value);
        if !vcore.is_empty() && looks_secret(vcore) && !is_marker(vlead, vcore) {
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

/// Mask every private key block (`mask_private_key_blocks`) and every
/// whitespace-delimited token that looks like a credential
/// ([`value_looks_secret`], with the prose floor above), keeping all other
/// text and all whitespace byte for byte.
pub fn redact_text(s: &str) -> String {
    mask_private_key_blocks(s)
}

const PEM_BEGIN: &str = "-----BEGIN ";
const PEM_DASHES: &str = "-----";

/// The next `-----BEGIN <LABEL>-----` marker at or after `from`:
/// (marker start, marker end, label).
fn next_pem_begin(s: &str, from: usize) -> Option<(usize, usize, &str)> {
    let mut at = from;
    while let Some(i) = s[at..].find(PEM_BEGIN) {
        let label_start = at + i + PEM_BEGIN.len();
        let label_len = s[label_start..]
            .find(|c: char| !(c.is_ascii_uppercase() || c.is_ascii_digit() || c == ' '))
            .unwrap_or(s.len() - label_start);
        let label = &s[label_start..label_start + label_len];
        if !label.trim().is_empty() && s[label_start + label_len..].starts_with(PEM_DASHES) {
            return Some((at + i, label_start + label_len + PEM_DASHES.len(), label));
        }
        at = label_start;
    }
    None
}

/// A PEM body that is only base64 (line breaks allowed, `=` only as the final
/// padding): what a certificate or public key carries.
fn is_base64_body(body: &str) -> bool {
    let mut pad = 0;
    body.chars().filter(|c| !c.is_whitespace()).all(|c| {
        if c == '=' {
            pad += 1;
            pad <= 2
        } else {
            pad == 0 && (c.is_ascii_alphanumeric() || c == '+' || c == '/')
        }
    })
}

/// Replace a private key body with [`REDACTED`], keeping the whitespace that
/// joins it to its markers.
fn push_masked_body(out: &mut String, body: &str) {
    let core = body.trim();
    if core.is_empty() {
        out.push_str(body);
        return;
    }
    let lead = body.len() - body.trim_start().len();
    out.push_str(&body[..lead]);
    out.push_str(REDACTED);
    out.push_str(&body[lead + core.len()..]);
}

/// A key pasted as a PEM block is judged as one unit, not line by line: the
/// token rule masked its 64-character lines by density and let the short
/// last line through. A block whose label names a `PRIVATE KEY` keeps its
/// BEGIN and END markers and loses everything between them; with no matching
/// END (a paste cut short, or an END naming another label) it masks to the
/// end of the text. A certificate or public key is not a secret: a block of
/// any other label whose body is plain base64 is kept whole, and one whose
/// body is anything else is left to the token rule.
fn mask_private_key_blocks(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut done = 0; // bytes of `s` already written to `out`
    let mut from = 0; // where the next marker search starts
    while let Some((start, body_start, label)) = next_pem_begin(s, from) {
        let end_marker = format!("-----END {label}-----");
        let body_end = s[body_start..].find(&end_marker).map(|i| body_start + i);
        if label.contains("PRIVATE KEY") {
            out.push_str(&mask_tokens(&s[done..start]));
            out.push_str(&s[start..body_start]);
            match body_end {
                Some(end) => {
                    push_masked_body(&mut out, &s[body_start..end]);
                    out.push_str(&end_marker);
                    done = end + end_marker.len();
                }
                None => {
                    push_masked_body(&mut out, &s[body_start..]);
                    done = s.len();
                }
            }
            from = done;
        } else if let Some(end) = body_end.filter(|&e| is_base64_body(&s[body_start..e])) {
            out.push_str(&mask_tokens(&s[done..start]));
            done = end + end_marker.len();
            out.push_str(&s[start..done]);
            from = done;
        } else {
            from = body_start;
        }
    }
    out.push_str(&mask_tokens(&s[done..]));
    out
}

/// The token rule: mask every whitespace-delimited token that looks like a
/// credential, keeping all other text and all whitespace byte for byte.
fn mask_tokens(s: &str) -> String {
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
        let masked = mask_token(tok, forced);
        // A key that already masked its own value (`PASSWORD=c2Vj==` ends in
        // `=` too) does not take the next word with it.
        after_secret_key = masked.is_none() && core.ends_with(['=', ':']) && names_a_secret(core);
        match masked {
            Some(masked) => out.push_str(&masked),
            None => out.push_str(tok),
        }
        after_bearer = is_bearer;
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

    #[test]
    fn joined_pairs_are_judged_one_by_one() {
        // Judged whole, the name before the last `=` named a secret, so the
        // database was masked and the password went out.
        assert_eq!(
            redact_text("Server=db;User=sa;Password=hunter2;Database=prod"),
            "Server=db;User=sa;Password=[redacted];Database=prod"
        );
        assert_eq!(
            redact_text("a=1&client_secret=xyz&b=2"),
            "a=1&client_secret=[redacted]&b=2"
        );
        let plain = "Server=db;Database=prod;Timeout=30 R&D";
        assert_eq!(redact_text(plain), plain);
        // A secret-named value runs from its first separator.
        assert_eq!(
            redact_text("DB_PASSWORD=c2VjcmV0cGFzcw=="),
            "DB_PASSWORD=[redacted]"
        );
    }

    #[test]
    fn a_private_key_block_is_masked_as_one_unit() {
        let (begin, end) = (
            "-----BEGIN EC PRIVATE KEY-----",
            "-----END EC PRIVATE KEY-----",
        );
        // The short last line is what the token rule let through.
        let text = format!("see:\n{begin}\nMHcCAQEEIabc\nxyz==\n{end}\nthanks");
        assert_eq!(
            redact_text(&text),
            format!("see:\n{begin}\n[redacted]\n{end}\nthanks")
        );
        // Cut short, it fails closed: everything after the marker goes.
        let cut = format!("see:\n{begin}\nMHcCAQEEIabc\nthanks");
        assert_eq!(redact_text(&cut), format!("see:\n{begin}\n[redacted]"));
        // A certificate is public and stays whole.
        let cert = format!(
            "-----BEGIN CERTIFICATE-----\n{}\nAbc+/9==\n-----END CERTIFICATE-----",
            "A".repeat(64)
        );
        assert_eq!(redact_text(&cert), cert);
    }

    #[test]
    fn a_bare_cloud_key_is_masked_and_a_path_of_its_shape_is_kept() {
        let aws = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"; // AWS's documented example
        assert_eq!(
            redact_text(&format!("secret {aws} ok")),
            "secret [redacted] ok"
        );
        for kept in [
            "docs/Guides/Setup2/WindowsMacOS/Readme12",
            "src/features/overview/components/Metric2",
            "/api/v2/Users/4821/Settings/Profile/Edit",
        ] {
            assert_eq!(kept.len(), 40, "{kept}");
            assert_eq!(redact_text(kept), kept);
        }
    }

    /// The shared redaction cases. `personas-web` keeps a byte-identical copy
    /// and masks a say with the same rules before it signs it, so a case
    /// changed here is a change on both sides.
    const FIXTURE: &str = include_str!("../../../../fixtures/redact-text-v2.json");

    #[test]
    fn every_shared_fixture_case_holds() {
        assert!(
            !FIXTURE.contains('\r'),
            "the fixture is copied byte for byte: keep it LF"
        );
        let doc: serde_json::Value = serde_json::from_str(FIXTURE).expect("fixture is JSON");
        assert_eq!(doc["version"], 2);
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
    fn every_fixture_expected_is_a_fixed_point() {
        let doc: serde_json::Value = serde_json::from_str(FIXTURE).expect("fixture is JSON");
        for case in doc["cases"].as_array().expect("cases is an array") {
            let expected = case["expected"].as_str().expect("expected is a string");
            assert_eq!(
                redact_text(expected),
                expected,
                "case {} is not a fixed point",
                case["name"]
            );
        }
    }

    #[test]
    fn a_value_that_is_already_the_marker_is_kept() {
        for same in [
            "DB_PASSWORD=[redacted]",
            "password: [redacted]",
            "Authorization: Bearer [redacted]",
            r#"{"client_secret":"[redacted]"}"#,
            "?access_token=[redacted]&page=2",
        ] {
            assert_eq!(redact_text(same), same);
        }
    }

    #[test]
    fn the_forced_branch_keeps_a_marker_and_masks_anything_else() {
        assert_eq!(redact_text("Bearer [redacted]."), "Bearer [redacted].");
        assert_eq!(redact_text("Bearer hunter2"), "Bearer [redacted]");
        assert_eq!(redact_text("password: hunter2"), "password: [redacted]");
    }

    #[test]
    fn a_near_marker_is_still_masked() {
        assert_eq!(
            redact_text("DB_PASSWORD=redacted"),
            "DB_PASSWORD=[redacted]"
        );
        let out = redact_text("DB_PASSWORD=[redacted]hunter2");
        assert!(!out.contains("hunter2"), "{out}");
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

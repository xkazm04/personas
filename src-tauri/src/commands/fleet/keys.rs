//! Vim-style key notation for the TUI driver plans.
//!
//! Fleet drives Claude Code's question TUI by writing raw byte chunks — `b"\x1b[B"`,
//! `b" "`, `b"\r"`. Two problems with keeping that as the only representation:
//!
//! 1. **Plans were unreadable in the logs.** The multi-select trace rendered its
//!    plan as `["\u{1b}[B", "\u{1b}[B", " ", "\r"]`, and the shareable debug log
//!    recorded only "N keystrokes". When a driven multi-select silently failed at
//!    16-session scale, the plan itself was not legible in either artifact — it
//!    had to be reconstructed by driving a stuck session key-by-key over the
//!    bridge.
//! 2. **Plans were awkward to assert on.** A test wanting "down, down, space,
//!    right, enter" had to spell out byte vectors.
//!
//! So: `<Down><Down><Space><Right><CR>` in, the same byte chunks out.
//!
//! **Chunking is semantic here, not cosmetic.** Claude Code's composer
//! distinguishes a *typed* Enter (a lone `\r` write) from a *pasted* one (a `\r`
//! inside a larger write) — the latter inserts a soft line-break and does NOT
//! submit. That distinction caused the 2026-07-24 incident where an auto-fired
//! instruction sat unsubmitted in the composer until the doze pass reaped the
//! session. [`parse_plan`] therefore emits **one chunk per key**, so a plan
//! written in notation cannot accidentally collapse into a paste.
//!
//! Notation adapted from xAI's `ptyctl` (`grok-build`), which parses the same
//! vim-style strings for its PTY control surface.

/// `→` — used by both the tabbed-AskUserQuestion Submit hop and the
/// confirmed-submit retry. Named so call sites stop repeating the literal.
pub const RIGHT: &[u8] = b"\x1b[C";

/// `ESC[200~` — DECSET 2004 bracketed-paste START.
pub const PASTE_START: &[u8] = b"\x1b[200~";

/// `ESC[201~` — DECSET 2004 bracketed-paste END.
pub const PASTE_END: &[u8] = b"\x1b[201~";

/// Frame `text` the way a real terminal paste arrives, iff it needs it.
///
/// The typed-vs-pasted distinction is the whole ballgame for a TUI composer: a
/// newline that arrives as a keystroke SUBMITS, a newline that arrives inside a
/// paste inserts a soft line-break. A multi-line programmatic payload (a
/// broadcast typed into a 5-row textarea, a skill body) written raw therefore
/// submitted its first line and left the rest to be submitted as separate,
/// truncated prompts.
///
/// The interactive lane already gets this right: `fleetTerminalManager`'s
/// clipboard path hands the payload to `@xterm/xterm`'s `paste()`, which
/// normalises `\r?\n` → `\r` and wraps the result in the brackets. This is the
/// same transformation for the lane that never goes through an emulator, byte
/// for byte — deliberately, so the two lanes cannot diverge.
///
/// **Single-line text is returned untouched.** A payload with no internal
/// newline needs no framing, and `/compact` must keep arriving as the exact six
/// bytes it always has.
pub fn frame_paste(text: &str) -> Vec<u8> {
    if !text.contains('\n') && !text.contains('\r') {
        return text.as_bytes().to_vec();
    }
    // xterm's `prepareTextForTerminal`: `text.replace(/\r?\n/g, '\r')`.
    let normalized = text.replace("\r\n", "\r").replace('\n', "\r");
    let mut out = Vec::with_capacity(PASTE_START.len() + normalized.len() + PASTE_END.len());
    out.extend_from_slice(PASTE_START);
    out.extend_from_slice(normalized.as_bytes());
    out.extend_from_slice(PASTE_END);
    out
}

/// Parse vim-style notation into byte chunks, **one chunk per key**.
///
/// Literal characters coalesce into a single text chunk (a paste is what you
/// want for text); every `<Key>` is its own chunk (a keystroke is what you want
/// for navigation and submission).
///
/// ```ignore
/// parse_plan("<Down><Space><CR>") == vec![b"\x1b[B", b" ", b"\r"]
/// parse_plan("hi<CR>")            == vec![b"hi", b"\r"]
/// ```
///
/// Currently exercised by tests only — the production driver still BUILDS plans
/// (it computes which options to toggle) and only needs [`describe_plan`] to
/// render them. This is the inverse half, kept so a plan and its expectation can
/// be written in one vocabulary, and so a future declarative plan (a fixed
/// submit tail, a scripted recovery sequence) has a parser that already round-
/// trips against `describe_plan`. Marked rather than silenced globally, so it
/// still warns if it stops being used by tests too.
#[cfg_attr(not(test), allow(dead_code))]
pub fn parse_plan(notation: &str) -> Result<Vec<Vec<u8>>, String> {
    let mut chunks: Vec<Vec<u8>> = Vec::new();
    let mut literal = String::new();
    let mut rest = notation;

    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('<') {
            // No '>' means an unterminated '<', which is a literal '<' — fall
            // through to the literal path below, matching ptyctl.
            if let Some(end) = after.find('>') {
                // Flush any pending literal run as its own chunk first.
                if !literal.is_empty() {
                    chunks.push(std::mem::take(&mut literal).into_bytes());
                }
                chunks.push(parse_key(&after[..end])?);
                rest = &after[end + 1..];
                continue;
            }
        }
        let ch = rest.chars().next().expect("non-empty");
        literal.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    if !literal.is_empty() {
        chunks.push(literal.into_bytes());
    }
    Ok(chunks)
}

/// Resolve the text between `<` and `>` to its byte sequence.
#[cfg_attr(not(test), allow(dead_code))]
fn parse_key(name: &str) -> Result<Vec<u8>, String> {
    let lower = name.to_ascii_lowercase();
    // `<C-x>` — control chars are (letter & 0x1f).
    if let Some(c) = lower.strip_prefix("c-") {
        let mut it = c.chars();
        return match (it.next(), it.next()) {
            (Some(ch), None) if ch.is_ascii_alphabetic() => {
                Ok(vec![(ch.to_ascii_uppercase() as u8) & 0x1f])
            }
            _ => Err(format!("unsupported control key: <{name}>")),
        };
    }
    let bytes: &[u8] = match lower.as_str() {
        "cr" | "enter" | "return" => b"\r",
        "lf" => b"\n",
        "esc" | "escape" => b"\x1b",
        "tab" => b"\t",
        "space" | "spc" => b" ",
        "bs" | "backspace" => b"\x7f",
        "up" => b"\x1b[A",
        "down" => b"\x1b[B",
        "right" => b"\x1b[C",
        "left" => b"\x1b[D",
        "home" => b"\x1b[H",
        "end" => b"\x1b[F",
        "lt" => b"<",
        "gt" => b">",
        _ => return Err(format!("unknown key notation: <{name}>")),
    };
    Ok(bytes.to_vec())
}

/// Render a plan back to notation for logging.
///
/// **Safe for the shareable debug log.** Recognised keys render as `<Down>`;
/// anything else is a text chunk and renders as `text(Nch)` — the LENGTH only,
/// never the content. The recorder's contract is that it never writes terminal
/// contents (the file is meant to be shareable, and driven text can carry the
/// user's code and paths), and a plan is only useful for debugging as its
/// *shape* anyway.
pub fn describe_plan(plan: &[Vec<u8>]) -> String {
    plan.iter()
        .map(|c| describe_chunk(c))
        .collect::<Vec<_>>()
        .join("")
}

/// Render one chunk. See [`describe_plan`] for the redaction rule.
pub fn describe_chunk(bytes: &[u8]) -> String {
    let named = match bytes {
        b"\r" => Some("CR"),
        b"\n" => Some("LF"),
        b"\x1b" => Some("Esc"),
        b"\t" => Some("Tab"),
        b" " => Some("Space"),
        b"\x7f" => Some("BS"),
        b"\x1b[A" => Some("Up"),
        b"\x1b[B" => Some("Down"),
        b"\x1b[C" => Some("Right"),
        b"\x1b[D" => Some("Left"),
        b"\x1b[H" => Some("Home"),
        b"\x1b[F" => Some("End"),
        _ => None,
    };
    match named {
        Some(n) => format!("<{n}>"),
        // Length in CHARS, not bytes, so a multi-byte answer doesn't read as
        // longer than the user typed.
        None => format!("text({}ch)", String::from_utf8_lossy(bytes).chars().count()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_navigation_keys_as_separate_chunks() {
        let plan = parse_plan("<Down><Space><Right><CR>").unwrap();
        assert_eq!(
            plan,
            vec![
                b"\x1b[B".to_vec(),
                b" ".to_vec(),
                b"\x1b[C".to_vec(),
                b"\r".to_vec()
            ]
        );
    }

    #[test]
    fn enter_is_always_its_own_chunk() {
        // The whole point: `hi<CR>` must NOT become a single "hi\r" write, which
        // Claude Code's composer treats as a paste and does not submit.
        let plan = parse_plan("hi<CR>").unwrap();
        assert_eq!(plan, vec![b"hi".to_vec(), b"\r".to_vec()]);
        assert_eq!(plan.len(), 2, "text and Enter must be separate writes");
    }

    #[test]
    fn literal_run_coalesces_into_one_chunk() {
        assert_eq!(parse_plan("hello").unwrap(), vec![b"hello".to_vec()]);
    }

    #[test]
    fn control_keys_and_case_insensitivity() {
        assert_eq!(parse_plan("<C-c>").unwrap(), vec![vec![0x03]]);
        assert_eq!(parse_plan("<cr>").unwrap(), parse_plan("<CR>").unwrap());
        assert_eq!(parse_plan("<Esc>").unwrap(), vec![b"\x1b".to_vec()]);
    }

    #[test]
    fn unknown_key_is_an_error_not_a_silent_literal() {
        // A typo'd plan must fail loudly — silently typing the literal text
        // "<Sumbit>" into a session would be worse than not driving at all.
        assert!(parse_plan("<Sumbit>").is_err());
    }

    #[test]
    fn unterminated_angle_is_literal() {
        assert_eq!(parse_plan("a<b").unwrap(), vec![b"a<b".to_vec()]);
    }

    #[test]
    fn describe_round_trips_navigation() {
        let notation = "<Down><Down><Space><Right><CR>";
        assert_eq!(describe_plan(&parse_plan(notation).unwrap()), notation);
    }

    #[test]
    fn describe_redacts_text_content() {
        // The shareable debug log must never carry the user's text.
        let plan = parse_plan("rm -rf /secret/path<CR>").unwrap();
        let described = describe_plan(&plan);
        assert!(!described.contains("secret"), "leaked text: {described}");
        assert!(!described.contains("rm -rf"), "leaked text: {described}");
        assert_eq!(described, "text(19ch)<CR>");
    }

    #[test]
    fn describe_counts_chars_not_bytes() {
        let plan = parse_plan("héllo").unwrap();
        assert_eq!(describe_plan(&plan), "text(5ch)");
    }

    #[test]
    fn right_constant_matches_notation() {
        assert_eq!(RIGHT, parse_plan("<Right>").unwrap()[0].as_slice());
    }

    #[test]
    fn single_line_text_is_never_framed() {
        // The five programmatic call sites all ship `${text}\r`; after the
        // trailing-newline trim a single-line payload must stay byte-identical
        // to what shipped before framing existed.
        assert_eq!(frame_paste("/compact"), b"/compact".to_vec());
        assert_eq!(frame_paste(""), Vec::<u8>::new());
        assert_eq!(
            frame_paste("fix the failing test in auth.rs"),
            b"fix the failing test in auth.rs".to_vec()
        );
    }

    #[test]
    fn a_multi_line_payload_is_bracketed_and_newline_normalised() {
        let framed = frame_paste("one\ntwo\nthree");
        assert_eq!(framed, b"\x1b[200~one\rtwo\rthree\x1b[201~".to_vec());
        // CRLF collapses to a single CR, exactly as xterm's paste() does —
        // not to `\r\r`, which the composer would read as two line breaks.
        assert_eq!(
            frame_paste("one\r\ntwo"),
            b"\x1b[200~one\rtwo\x1b[201~".to_vec()
        );
        // A lone CR is already the paste form and passes through framed.
        assert_eq!(frame_paste("a\rb"), b"\x1b[200~a\rb\x1b[201~".to_vec());
    }

    #[test]
    fn framing_starts_and_ends_with_the_bracket_constants() {
        let framed = frame_paste("x\ny");
        assert!(framed.starts_with(PASTE_START));
        assert!(framed.ends_with(PASTE_END));
        // The last byte is `~`, never a bare newline — which is precisely the
        // shape `fleet_write_input` uses to tell a paste from a typed line.
        assert_eq!(*framed.last().unwrap(), b'~');
    }
}
